from __future__ import annotations

import logging

import pytest
from sqlalchemy import select, update

from this_is_you.models import Document, ExtractionStatus

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, upload


def imported(client, body, name="report.pdf"):
    response = upload(client, body, name)
    assert response.status_code in (200, 201), response.text
    client.app.state.extraction.wait_idle()
    return client.get(f"/api/documents/{response.json()['document']['id']}").json()


def decide(client, doc, field, **body):
    return client.post(f"/api/documents/{doc['id']}/metadata/{field}", json=body, headers=CLIENT_HEADERS)


def confirm(client, doc, field):
    return decide(client, doc, field, action="confirmed", proposal_id=doc["metadata"][field]["proposal"]["id"])


FIELDS = ["document_type", "service_date", "provider", "report_title"]


def resolve_measurements(client, doc):
    """Metadata review also waits on any measurements the document contains."""
    for o in client.get("/api/observations").json()["observations"]:
        if o["document_id"] == doc["id"]:
            client.post(f"/api/observations/{o['id']}/reject", json={}, headers=CLIENT_HEADERS)


def test_upload_returns_before_reading_and_starts_unverified(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert doc["extraction_status"] == "extracted"
    assert doc["review_status"] == "not_started"
    assert doc["verification_status"] == "unverified"
    assert doc["page_count"] == 1


def test_inferred_values_are_never_reported_as_the_value(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    for field in FIELDS:
        entry = doc["metadata"][field]
        assert entry["state"] == "proposed"
        assert entry["value"] is None
        assert entry["decided_at"] is None
        assert entry["proposal"]["value"]
        assert entry["proposal"]["method"] == "rules-v2"


def test_even_a_high_confidence_proposal_stays_unverified(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert doc["metadata"]["service_date"]["proposal"]["confidence"] == "high"
    assert doc["verification_status"] == "unverified"


def test_confirm_records_the_value_and_keeps_provenance(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    result = confirm(client, doc, "service_date").json()
    entry = result["metadata"]["service_date"]
    assert entry["state"] == "confirmed" and entry["value"] == "2024-03-12" and entry["decided_at"]
    assert entry["proposal"]["snippet"] == "Specimen Collected: March 12, 2024"
    assert result["verification_status"] == "partially_verified"
    assert result["review_status"] == "in_progress"


def test_correct_keeps_the_extracted_value_alongside(client):
    doc = imported(client, pdfs.text_pdf(pdfs.AMBIGUOUS_DATE))
    result = decide(client, doc, "service_date", action="corrected", value="2020-11-03").json()
    entry = result["metadata"]["service_date"]
    assert entry["state"] == "corrected" and entry["value"] == "2020-11-03"
    assert entry["proposal"]["value"] == "2020-03-11"
    assert result["decisions"][0]["proposed_value"] == "2020-03-11"


def test_correcting_to_the_same_value_counts_as_a_confirmation(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    entry = decide(client, doc, "service_date", action="corrected", value="2024-03-12").json()["metadata"]["service_date"]
    assert entry["state"] == "confirmed"


def test_decisions_are_an_append_only_history(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    confirm(client, doc, "provider")
    decide(client, doc, "provider", action="corrected", value="First Correction")
    result = decide(client, doc, "provider", action="corrected", value="Second Correction").json()
    assert [(d["action"], d["value"]) for d in result["decisions"]] == [("confirmed", "Northwood Diagnostics Laboratory"), ("corrected", "First Correction"), ("corrected", "Second Correction")]
    assert result["metadata"]["provider"]["value"] == "Second Correction"


def test_not_stated_is_a_decision_but_not_verification(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    for field in FIELDS[:-1]:
        confirm(client, doc, field)
    resolve_measurements(client, doc)
    result = decide(client, doc, "report_title", action="not_stated").json()
    assert result["metadata"]["report_title"]["state"] == "not_stated"
    assert result["metadata"]["report_title"]["value"] is None
    assert result["verification_status"] == "partially_verified"
    done = client.post(f"/api/documents/{doc['id']}/review", json={"complete": True}, headers=CLIENT_HEADERS).json()
    assert done["review_status"] == "completed" and done["verification_status"] == "partially_verified"


def test_review_cannot_complete_until_every_detail_is_decided(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    url = f"/api/documents/{doc['id']}/review"
    response = client.post(url, json={"complete": True}, headers=CLIENT_HEADERS)
    assert response.status_code == 409 and response.json()["code"] == "undecided_fields"
    for field in FIELDS:
        confirm(client, doc, field)
    resolve_measurements(client, doc)
    done = client.post(url, json={"complete": True}, headers=CLIENT_HEADERS).json()
    assert done["review_status"] == "completed" and done["verification_status"] == "verified"


def test_changing_a_detail_reopens_a_finished_review(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    for field in FIELDS:
        confirm(client, doc, field)
    resolve_measurements(client, doc)
    client.post(f"/api/documents/{doc['id']}/review", json={"complete": True}, headers=CLIENT_HEADERS)
    result = decide(client, doc, "provider", action="corrected", value="A Different Fictional Lab").json()
    assert result["review_status"] == "in_progress"
    assert result["verification_status"] == "verified"


def test_confirm_refuses_a_proposal_the_person_did_not_see(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    response = decide(client, doc, "provider", action="confirmed", proposal_id=999999)
    assert response.status_code == 409 and response.json()["code"] == "stale_proposal"
    assert decide(client, doc, "provider", action="confirmed").status_code == 409


def test_confirm_needs_a_proposal(client):
    doc = imported(client, pdfs.image_only_pdf())
    assert decide(client, doc, "provider", action="confirmed", proposal_id=1).status_code == 409


@pytest.mark.parametrize(
    "field,value",
    [("service_date", "not a date"), ("service_date", "2020-13-45"), ("service_date", "2199-01-01"), ("service_date", "1800-01-01"), ("document_type", "unclassified"), ("document_type", "whatever"), ("provider", ""), ("provider", "   "), ("provider", "x" * 256), ("report_title", None)],
)
def test_bad_corrections_are_refused_and_change_nothing(client, field, value):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert decide(client, doc, field, action="corrected", value=value).status_code == 422
    after = client.get(f"/api/documents/{doc['id']}").json()
    assert after["decisions"] == [] and after["review_status"] == "not_started"


def test_control_characters_are_removed_from_corrections(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert decide(client, doc, "provider", action="corrected", value="A\x00 Fictional\x07 Lab").json()["metadata"]["provider"]["value"] == "A Fictional Lab"


@pytest.mark.parametrize("path,code", [("metadata/verified", 422), ("metadata/../content", 404)])
def test_unknown_fields_are_refused(client, path, code):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert client.post(f"/api/documents/{doc['id']}/{path}", json={"action": "confirmed"}, headers=CLIENT_HEADERS).status_code in (code, 404, 405, 422)


def test_oversized_and_malformed_bodies_are_refused(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    url = f"/api/documents/{doc['id']}/metadata/provider"
    assert client.post(url, content=b'{"action":"corrected","value":"' + b"x" * 20000 + b'"}', headers=CLIENT_HEADERS).status_code == 413
    assert client.post(url, content=b"not json", headers=CLIENT_HEADERS).status_code == 422
    assert client.post(url, json={"action": "verified"}, headers=CLIENT_HEADERS).status_code == 422


def test_decisions_need_the_app_header(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert client.post(f"/api/documents/{doc['id']}/metadata/provider", json={"action": "not_stated"}).status_code == 403
    assert client.post(f"/api/documents/{doc['id']}/review", json={"complete": True}).status_code == 403
    assert client.post(f"/api/documents/{doc['id']}/extract").status_code == 403


def test_corrections_never_touch_the_original_file(client, data_dir):
    body = pdfs.text_pdf(pdfs.LAB_REPORT)
    doc = imported(client, body)
    stored = next(p for p in (data_dir / "originals").rglob("*") if p.is_file())
    before = stored.stat().st_mtime_ns
    decide(client, doc, "provider", action="corrected", value="A Fictional Lab")
    confirm(client, doc, "service_date")
    assert stored.read_bytes() == body and stored.stat().st_mtime_ns == before
    assert client.get(doc["content_url"]).content == body
    assert client.get(f"/api/documents/{doc['id']}").json()["sha256"] == doc["sha256"]


def test_corrections_and_statuses_survive_a_restart(data_dir):
    first = client_for(data_dir)
    doc = imported(first, pdfs.text_pdf(pdfs.AMBIGUOUS_DATE))
    decide(first, doc, "service_date", action="corrected", value="2020-11-03")
    confirm(first, doc, "document_type")
    decide(first, doc, "provider", action="not_stated")
    decide(first, doc, "report_title", action="corrected", value="Fictional Corrected Title")
    first.post(f"/api/documents/{doc['id']}/review", json={"complete": True}, headers=CLIENT_HEADERS)
    expected = first.get(f"/api/documents/{doc['id']}").json()
    first.app.state.engine.dispose()

    second = client_for(data_dir)
    second.app.state.extraction.wait_idle()
    after = second.get(f"/api/documents/{doc['id']}").json()
    assert after == expected
    assert after["metadata"]["service_date"]["value"] == "2020-11-03"
    assert after["review_status"] == "completed"
    assert len(after["runs"]) == 1  # Not read again.


def test_rereading_adds_proposals_and_keeps_decisions(client):
    doc = imported(client, pdfs.text_pdf(pdfs.AMBIGUOUS_DATE))
    decide(client, doc, "service_date", action="corrected", value="2020-11-03")
    response = client.post(f"/api/documents/{doc['id']}/extract", headers=CLIENT_HEADERS)
    assert response.status_code == 200
    client.app.state.extraction.wait_idle()
    after = client.get(f"/api/documents/{doc['id']}").json()
    assert len(after["runs"]) == 2
    assert after["metadata"]["service_date"]["value"] == "2020-11-03"
    assert after["metadata"]["service_date"]["state"] == "corrected"
    assert after["metadata"]["provider"]["proposal"]["id"] != doc["metadata"]["provider"]["proposal"]["id"]
    # The old proposal id is now stale.
    assert confirm(client, doc, "provider").status_code == 409


def test_interrupted_reads_resume_after_a_restart(data_dir):
    first = client_for(data_dir)
    doc = imported(first, pdfs.text_pdf(pdfs.LAB_REPORT))
    with first.app.state.engine.begin() as connection:
        connection.execute(update(Document).values(extraction_status=ExtractionStatus.RUNNING))
    first.app.state.engine.dispose()
    second = client_for(data_dir)
    second.app.state.extraction.wait_idle()
    assert second.get(f"/api/documents/{doc['id']}").json()["extraction_status"] == "extracted"


@pytest.mark.parametrize(
    "body,status",
    [(pdfs.image_only_pdf(), "image_only"), (pdfs.encrypted_pdf(pdfs.LAB_REPORT), "encrypted"), (b"%PDF-1.4\nnot really\n%%EOF\n", "failed")],
)
def test_unreadable_pdfs_stay_stored_viewable_and_reviewable_by_hand(client, body, status):
    doc = imported(client, body)
    assert doc["extraction_status"] == status
    assert all(doc["metadata"][f]["state"] == "missing" for f in FIELDS)
    assert client.get(doc["content_url"]).content == body
    result = decide(client, doc, "service_date", action="corrected", value="2019-06-01").json()
    assert result["metadata"]["service_date"]["state"] == "corrected"


def test_identical_upload_is_not_read_twice(client):
    body = pdfs.text_pdf(pdfs.LAB_REPORT)
    doc = imported(client, body)
    again = imported(client, body, "copy.pdf")
    assert again["id"] == doc["id"] and len(again["runs"]) == 1


def test_duplicate_upload_keeps_decisions(client):
    body = pdfs.text_pdf(pdfs.LAB_REPORT)
    doc = imported(client, body)
    decide(client, doc, "provider", action="corrected", value="A Fictional Lab")
    again = imported(client, body, "copy.pdf")
    assert again["metadata"]["provider"]["value"] == "A Fictional Lab"


def test_same_text_in_a_different_file_is_flagged_not_merged(client):
    a = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT, title="First save"), "a.pdf")
    b = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT, title="Second save"), "b.pdf")
    assert a["sha256"] != b["sha256"]
    listing = {d["id"]: d for d in client.get("/api/documents").json()["documents"]}
    assert len(listing) == 2
    assert listing[a["id"]]["possible_duplicates"] == [b["id"]]
    assert listing[b["id"]]["possible_duplicates"] == [a["id"]]


def test_different_reports_are_not_flagged(client):
    imported(client, pdfs.text_pdf(pdfs.LAB_REPORT), "a.pdf")
    imported(client, pdfs.text_pdf(pdfs.RADIOLOGY_REPORT), "b.pdf")
    assert all(d["possible_duplicates"] == [] for d in client.get("/api/documents").json()["documents"])


def test_logs_hold_no_document_text_or_patient_details(client, caplog):
    caplog.set_level(logging.DEBUG)
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT), "avery-testperson-labs.pdf")
    decide(client, doc, "provider", action="corrected", value="SECRET CORRECTION VALUE")
    assert any("extraction extracted" in r.getMessage() for r in caplog.records)
    for secret in ("Avery", "Testperson", "Northwood", "Hemoglobin", "March 12", "2024-03-12", "SECRET CORRECTION"):
        assert secret not in caplog.text


def test_a_slow_or_hostile_file_does_not_block_the_listing(client):
    upload(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    assert client.get("/api/documents").status_code == 200


def test_no_inferred_value_reaches_a_verified_column(client):
    doc = imported(client, pdfs.text_pdf(pdfs.LAB_REPORT))
    with client.app.state.sessions() as session:
        stored = session.scalars(select(Document).where(Document.id == doc["id"])).one()
        assert stored.decisions == []
        assert stored.verification_status.value == "unverified"
