"""Identity checks only ever raise a flag. No outcome refuses, removes, or verifies anything."""
from __future__ import annotations

from datetime import date

import pytest

from this_is_you.extraction.rules import find_patient
from this_is_you.identity import POSSIBLE_MATCH, POSSIBLE_MISMATCH, UNDETERMINED, Profile, assess, names_agree

from . import pdfs
from .conftest import CLIENT_HEADERS, upload

ME = Profile(("Avery Testperson", "Avery Oldname"), "1971-02-14")
TODAY = date(2026, 11, 2)


def found(*lines: str) -> dict:
    return find_patient([(1, "\n".join(lines))], TODAY)


@pytest.mark.parametrize("line, name", [
    ("Patient: Avery Testperson", "Avery Testperson"),
    ("Patient Name: TESTPERSON, AVERY Q", "TESTPERSON, AVERY Q"),
    ("Name: Avery Testperson DOB: 02/14/1971", "Avery Testperson"),
    ("PATIENT NAME: Avery Testperson MRN 12345", "Avery Testperson"),
    ("Pt Name: Avery Q. Testperson", "Avery Q. Testperson"),
    ("Patient: José O'Neill-Núñez", "José O'Neill-Núñez"),
])
def test_names_under_a_patient_label_are_found(line, name):
    assert [n["value"] for n in found(line)["names"]] == [name]


@pytest.mark.parametrize("line", ["Patient ID 12345", "Patient: 12345", "Ordering Physician: Dr. Fictional Example", "Patient education handout", "Name: x", "Provider Name: Someone Else"])
def test_other_lines_are_not_mistaken_for_a_patient(line):
    assert found(line)["names"] == []


@pytest.mark.parametrize("printed, agrees", [
    ("Avery Testperson", True), ("TESTPERSON, AVERY", True), ("Testperson, Avery Q.", True), ("A Testperson", True), ("Mrs. Avery Testperson Jr", True), ("Avéry Testpérson", True),
    ("Avery Oldname", False), ("Morgan Testperson", False), ("Avery Other", False), ("Testperson", False),
])
def test_comparing_names(printed, agrees):
    assert names_agree(printed, "Avery Testperson") is agrees


@pytest.mark.parametrize("found_value, status", [
    (found("Patient: Avery Testperson", "DOB: 02/14/1971"), POSSIBLE_MATCH),
    (found("Patient: Avery Oldname"), POSSIBLE_MATCH),  # A previous name counts.
    (found("DOB: 1971-02-14"), POSSIBLE_MATCH),
    (found("DOB: 14/02/1971"), POSSIBLE_MATCH),
    (found("Patient: Morgan Otherperson"), POSSIBLE_MISMATCH),
    (found("Patient: Avery Testperson", "DOB: 03/15/1980"), POSSIBLE_MISMATCH),  # The name fits and the date does not.
    (found("Patient: Morgan Otherperson", "DOB: 02/14/1971"), POSSIBLE_MISMATCH),
    (found("Patient: Avery Testperson", "Patient: Morgan Otherperson"), POSSIBLE_MISMATCH),  # Two people on one file.
    (found("Nothing that names anyone at all"), UNDETERMINED),
    (None, UNDETERMINED),
])
def test_assessments(found_value, status):
    assert assess(ME, found_value).status == status


def test_a_birth_date_that_reads_two_ways_matches_either_reading():
    assert assess(Profile(("A B",), "1971-04-03"), found("DOB: 03/04/1971")).status == POSSIBLE_MATCH
    assert assess(Profile(("A B",), "1971-03-04"), found("DOB: 03/04/1971")).status == POSSIBLE_MATCH


def test_without_a_profile_nothing_is_compared():
    assert assess(None, found("Patient: Morgan Otherperson")).status == "not_configured"


def test_a_birth_date_with_none_configured_is_undetermined():
    assert assess(Profile(("Avery Testperson",), None), found("DOB: 02/14/1971")).status == UNDETERMINED


def set_identity(client, **body):
    return client.put("/api/identity", json={"full_name": "Avery Testperson", "date_of_birth": "1971-02-14", **body}, headers=CLIENT_HEADERS)


OTHER_PERSON = ["Northwood Diagnostics Laboratory", "LABORATORY REPORT", "Patient: Morgan Otherperson", "DOB: 03/15/1980", "Collected: 03/28/2024", "Hemoglobin 14.20 g/dL 13.0-17.7"]


def test_a_mismatch_flags_and_never_blocks(client):
    set_identity(client)
    response = upload(client, pdfs.text_pdf(OTHER_PERSON), "someone else.pdf")
    assert response.status_code == 201
    client.app.state.extraction.wait_idle()
    document = client.get("/api/documents").json()["documents"][0]
    assert document["identity"]["status"] == POSSIBLE_MISMATCH
    assert document["extraction_status"] == "extracted"
    assert client.get(f"/api/documents/{document['id']}/content").status_code == 200
    assert "Morgan Otherperson" in document["identity"]["reason"]
    # Every step of review still works, and only a person's own acceptance verifies a result.
    observation = client.get("/api/observations").json()["observations"][0]
    assert observation["verification_status"] == "proposed"
    assert client.post(f"/api/observations/{observation['id']}/verify", headers=CLIENT_HEADERS).status_code == 200


def test_a_match_verifies_nothing(client):
    set_identity(client)
    upload(client, pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE), "mine.pdf")
    client.app.state.extraction.wait_idle()
    document = client.get("/api/documents").json()["documents"][0]
    assert document["identity"]["status"] == POSSIBLE_MATCH
    assert "not verification" in document["identity"]["reason"]
    assert document["verification_status"] == "unverified"
    assert {o["verification_status"] for o in client.get("/api/observations").json()["observations"]} == {"proposed"}


def test_changing_the_details_changes_the_flags_without_reading_again(client):
    upload(client, pdfs.text_pdf(OTHER_PERSON), "a.pdf")
    client.app.state.extraction.wait_idle()
    identity = lambda: client.get("/api/documents").json()["documents"][0]["identity"]["status"]  # noqa: E731
    assert identity() == "not_configured"
    set_identity(client)
    assert identity() == POSSIBLE_MISMATCH
    set_identity(client, full_name="Morgan Otherperson", date_of_birth="1980-03-15")
    assert identity() == POSSIBLE_MATCH


@pytest.mark.parametrize("make", [pdfs.image_only_pdf, lambda: pdfs.encrypted_pdf(OTHER_PERSON), lambda: pdfs.text_pdf(pdfs.UNCLEAR)], ids=["scan", "encrypted", "no-label"])
def test_unreadable_or_unlabelled_documents_are_undetermined(client, make):
    set_identity(client)
    upload(client, make(), "a.pdf")
    client.app.state.extraction.wait_idle()
    identity = client.get("/api/documents").json()["documents"][0]["identity"]
    assert identity["status"] == UNDETERMINED and "Could not be determined" in identity["reason"]


def test_the_report_counts_flags_and_filters_by_them(client):
    set_identity(client)
    batch = client.post("/api/import-batches", json={"label": "x"}, headers=CLIENT_HEADERS).json()["id"]
    files = {"x/mine.pdf": pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE), "x/theirs.pdf": pdfs.text_pdf(OTHER_PERSON), "x/scan.pdf": pdfs.image_only_pdf()}
    items = client.post(f"/api/import-batches/{batch}/items", json={"items": [{"path": p, "size": len(b), "modified": 1} for p, b in files.items()]}, headers=CLIENT_HEADERS).json()["items"]
    for item in items:
        client.post(f"/api/import-batches/{batch}/items/{item['id']}/file", content=files[item["path"]], headers={**CLIENT_HEADERS, "content-type": "application/pdf"})
    client.app.state.extraction.wait_idle()
    summary = client.get("/api/import-batches").json()["batches"][0]
    assert summary["identity_mismatches"] == 1 and summary["identity_undetermined"] == 1
    flagged = client.get(f"/api/import-batches/{batch}/items", params={"identity": POSSIBLE_MISMATCH}).json()
    assert [r["path"] for r in flagged["items"]] == ["x/theirs.pdf"]


def test_identity_stays_out_of_the_reader_and_the_logs(client, caplog):
    set_identity(client, full_name="Avery Uniquename")
    with caplog.at_level("INFO"):
        upload(client, pdfs.text_pdf(OTHER_PERSON), "a.pdf")
        client.app.state.extraction.wait_idle()
        client.get("/api/documents")
    assert "Uniquename" not in caplog.text and "Otherperson" not in caplog.text


@pytest.mark.parametrize("body", [{"full_name": "Solo"}, {"full_name": "Avery Testperson", "date_of_birth": "not a date"}, {"full_name": "Avery Testperson", "date_of_birth": "2999-01-01"}, {"full_name": ""}])
def test_bad_details_are_refused(client, body):
    assert client.put("/api/identity", json=body, headers=CLIENT_HEADERS).status_code == 422


def test_the_reader_is_never_given_the_details(client, monkeypatch):
    from this_is_you.extraction import runner

    seen: list[list[str]] = []
    real = runner.run_command
    monkeypatch.setattr(runner, "run_command", lambda command, seconds: (seen.append(command), real(command, seconds))[1])
    set_identity(client, full_name="Avery Uniquename")
    upload(client, pdfs.text_pdf(pdfs.LAB_REPORT), "a.pdf")
    client.app.state.extraction.wait_idle()
    assert seen and all("Uniquename" not in part and "1971-02-14" not in part for part in seen[0])
