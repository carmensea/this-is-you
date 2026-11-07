"""Reading a document again, at a person's request: what it may replace, and everything it must keep. Fictional data only."""
from __future__ import annotations

import dataclasses

import pytest
from sqlalchemy import text

from this_is_you import metadata

from . import pdfs
from .conftest import client_for
from .test_observations import imported, named, post, rows

URINALYSIS = [
    "Fictional Family Health Portal", "Collected on Mar 4, 2025 8:40 AM", "Urinalysis", "Component Value Standard Range",
    "URINE-COLOR", "Yellow", "Normal range: Yellow", "APPEARANCE", "Clear", "Normal range: Clear",
    "Specific Gravity", "1.015", "Normal range: 1.005 - 1.030", "pH, Urine", "6.0", "Normal range: 5.0 - 8.0",
    "Glucose", "92 mg/dL", "Normal range: 70 - 99 mg/dL", "Sodium", "139 mmol/L", "Normal range: 134 - 144 mmol/L",
]
# What the reader before the color and clarity fix made of those rows: the printed value taken as the name, and no value.
OLD_MISTAKES = {"URINE-COLOR": "Yellow", "APPEARANCE": "Clear"}


@pytest.fixture
def old_reader(monkeypatch):
    """Reads the way the earlier reader did, until the fixture is undone."""
    real = metadata.extract

    def misread(path, limits):
        result = real(path, limits)
        return dataclasses.replace(result, lab_rows=[{**r, "name": OLD_MISTAKES[r["name"]], "value": ""} if r["name"] in OLD_MISTAKES else r for r in result.lab_rows])

    monkeypatch.setattr(metadata, "extract", misread)
    return monkeypatch


def reread(client, doc):
    response = post(client, f"/api/documents/{doc}/extract")
    assert response.status_code == 200, response.text
    client.app.state.extraction.wait_idle()
    return client.get(f"/api/documents/{doc}").json()


def history(o):
    return [r["action"] for r in o["revisions"]]


def by_name(client, doc):
    return {(o["reported_name"], o["value_text"]): o for o in rows(client, doc)}


def test_a_requested_reread_replaces_the_old_misreading_and_keeps_every_decision(client, old_reader):
    doc = imported(client, URINALYSIS)
    assert {"Yellow", "Clear"} <= {o["reported_name"] for o in rows(client, doc)}
    post(client, f"/api/observations/{named(client, doc, 'Specific Gravity')['id']}/verify")
    post(client, f"/api/observations/{named(client, doc, 'Glucose')['id']}/correct", {"fields": {"value_text": "93"}})
    post(client, f"/api/observations/{named(client, doc, 'Sodium')['id']}/reject")
    before = {o["id"]: o for o in rows(client, doc)}
    old_reader.undo()

    detail = reread(client, doc)

    after = by_name(client, doc)
    assert after[("URINE-COLOR", "Yellow")]["verification_status"] == "proposed"
    assert after[("APPEARANCE", "Clear")]["verification_status"] == "proposed"
    for name in ("Yellow", "Clear"):
        stale = after[(name, "")]
        assert stale["verification_status"] == "superseded" and history(stale) == ["extracted", "superseded"]
        # Where it was read from stays with it, and so does what was first read.
        assert stale["source_page"] == before[stale["id"]]["source_page"] and stale["source_line"] == before[stale["id"]]["source_line"]
        assert stale["revisions"][0] == before[stale["id"]]["revisions"][0]
    for name in ("Specific Gravity", "Glucose", "Sodium", "pH, Urine"):
        o = named(client, doc, name)
        assert o == before[o["id"]]  # Decided or not, a row the new reading still finds is untouched.
    assert len(rows(client, doc)) == len(before) + 2
    assert len(detail["runs"]) == 2


def test_reading_again_twice_changes_nothing_the_second_time(client, old_reader):
    doc = imported(client, URINALYSIS)
    old_reader.undo()
    reread(client, doc)
    once = rows(client, doc)
    reread(client, doc)
    assert rows(client, doc) == once


def test_replaced_proposals_do_not_hold_up_the_review(client, old_reader):
    doc = imported(client, URINALYSIS)
    old_reader.undo()
    reread(client, doc)
    for o in rows(client, doc):
        if o["verification_status"] == "proposed":
            post(client, f"/api/observations/{o['id']}/reject")
    for field in client.get(f"/api/documents/{doc}").json()["metadata"]:
        post(client, f"/api/documents/{doc}/metadata/{field}", {"action": "not_stated"})
    assert post(client, f"/api/documents/{doc}/review", {"complete": True}).json()["review_status"] == "completed"


def test_a_replaced_proposal_can_be_brought_back(client, old_reader):
    doc = imported(client, URINALYSIS)
    old_reader.undo()
    reread(client, doc)
    stale = by_name(client, doc)[("Yellow", "")]
    post(client, f"/api/observations/{stale['id']}/reopen")
    back = by_name(client, doc)[("Yellow", "")]
    assert back["verification_status"] == "proposed" and history(back) == ["extracted", "superseded", "reopened"]


def test_a_proposal_a_person_has_touched_is_never_replaced(client, old_reader):
    doc = imported(client, URINALYSIS)
    yellow, clear = by_name(client, doc)[("Yellow", "")], by_name(client, doc)[("Clear", "")]
    post(client, f"/api/observations/{yellow['id']}/correct", {"fields": {"reported_name": "Color"}})  # Corrected, still undecided.
    post(client, f"/api/observations/{clear['id']}/reject")
    old_reader.undo()
    reread(client, doc)
    assert next(o for o in rows(client, doc) if o["id"] == yellow["id"])["verification_status"] == "proposed"
    assert next(o for o in rows(client, doc) if o["id"] == clear["id"])["verification_status"] == "rejected"


@pytest.mark.parametrize("outcome", [
    {"status": "failed", "lab_rows": []},
    {"status": "too_complex", "lab_rows": []},
    {"status": "partial", "pages_failed": 1},
    {"status": "extracted", "truncated": True},
])
def test_a_failed_or_incomplete_reading_never_replaces_anything(client, old_reader, outcome):
    doc = imported(client, URINALYSIS)
    old_reader.undo()
    real = metadata.extract
    old_reader.setattr(metadata, "extract", lambda path, limits: dataclasses.replace(real(path, limits), **outcome))
    reread(client, doc)
    assert not [o for o in rows(client, doc) if o["verification_status"] == "superseded"]


def test_a_row_missing_from_a_page_with_nothing_new_is_not_taken_as_replaced(client, monkeypatch):
    real = metadata.extract
    ghost = {"name": "Fictional Ghost Marker", "value": "7", "unit": "ng/mL", "reference": None, "flag": None, "collected": None, "reported": None,
             "page": 1, "line": 99, "source": "Fictional Ghost Marker 7 ng/mL", "issues": [], "confidence": "medium"}
    monkeypatch.setattr(metadata, "extract", lambda path, limits: dataclasses.replace(r := real(path, limits), lab_rows=r.lab_rows + [ghost]))
    doc = imported(client, pdfs.LIPID_BOUNDS)
    monkeypatch.undo()
    reread(client, doc)
    assert named(client, doc, "Fictional Ghost Marker")["verification_status"] == "proposed"


def test_only_a_persons_request_replaces_proposals_not_an_automatic_reading(data_dir, old_reader):
    first = client_for(data_dir)
    doc = imported(first, URINALYSIS)
    with first.app.state.engine.begin() as connection:
        connection.execute(text("UPDATE extraction_runs SET method = 'rules-v1'"))  # An older reader's tag: re-read at the next start.
    first.app.state.engine.dispose()
    old_reader.undo()
    second = client_for(data_dir)
    second.app.state.extraction.wait_idle()
    assert len(second.get(f"/api/documents/{doc}").json()["runs"]) == 2
    statuses = {o["reported_name"]: o["verification_status"] for o in rows(second, doc)}
    assert statuses["URINE-COLOR"] == "proposed" and statuses["Yellow"] == "proposed"  # Added, nothing replaced.
