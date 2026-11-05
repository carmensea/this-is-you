"""Clearing the two-readings warning from stored date proposals. Every record here is fictional."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from this_is_you import metadata_date_repair as module
from this_is_you.metadata_date_repair import repair_metadata_date_doubt as repair
from this_is_you.models import Confidence, DecisionAction, ExtractionRun, MetadataDecision, MetadataField, MetadataProposal

from . import pdfs
from .conftest import CLIENT_HEADERS, upload

LABELED = 'Labeled "date of service" in the document.'
DOUBT = " The numbers could be read two ways: 2024-03-11 or 2024-11-03."
SNIPPET = "Date of service: 03/11/2024"


def stored(client, reason=LABELED + DOUBT, snippet=SNIPPET, value="2024-03-11") -> str:
    """A report whose date proposal is as an older reading left it. The current rule no longer writes this."""
    document = upload(client, pdfs.text_pdf(["Fictional Clinic", SNIPPET, "Fictional note"]), "fictional.pdf").json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    with client.app.state.sessions() as session:
        run = session.scalars(select(ExtractionRun).where(ExtractionRun.document_id == document)).one()
        p = next(x for x in run.proposals if x.field is MetadataField.SERVICE_DATE)
        p.reason, p.confidence, p.source_snippet, p.value = reason, Confidence.LOW, snippet, value
        session.commit()
    return document


def sessions(client):
    return client.app.state.sessions


def detail(client, document) -> dict:
    return client.get(f"/api/documents/{document}").json()


def date_field(client, document) -> dict:
    return detail(client, document)["metadata"]["service_date"]


def date_rows(client, document) -> list[tuple]:
    with sessions(client)() as session:
        runs = session.scalars(select(ExtractionRun).where(ExtractionRun.document_id == document)).all()
        return [(p.value, p.confidence.value, p.reason, p.source_page, p.source_snippet) for r in runs for p in r.proposals if p.field is MetadataField.SERVICE_DATE]


def test_a_dry_run_changes_nothing(client):
    document = stored(client)
    before = detail(client, document), date_rows(client, document)
    report = repair(sessions(client))
    assert (report.candidates, dict(report.safe), dict(report.uncertain)) == (1, {"high": 1}, {})
    assert (detail(client, document), date_rows(client, document)) == before


def test_a_labeled_date_returns_to_high_with_the_date_and_old_row_kept(client):
    document = stored(client)
    before = date_rows(client, document)
    assert repair(sessions(client), apply=True).safe == {"high": 1}
    field = date_field(client, document)
    assert field["proposal"]["value"] == "2024-03-11" and field["proposal"]["confidence"] == "high"
    assert "two ways" not in field["proposal"]["reason"] and field["proposal"]["reason"] == LABELED
    assert field["proposal"]["snippet"] == SNIPPET and field["state"] == "proposed"
    assert date_rows(client, document)[:-1] == before, "the original proposal stays as the record"


def test_it_approves_nothing_and_changes_no_other_field(client):
    document = stored(client)
    before = detail(client, document)
    repair(sessions(client), apply=True)
    after = detail(client, document)
    assert {f: v for f, v in after["metadata"].items() if f != "service_date"} == {f: v for f, v in before["metadata"].items() if f != "service_date"}
    assert {x: after[x] for x in after if x != "metadata"} == {x: before[x] for x in before if x != "metadata"}
    assert after["verification_status"] == "unverified"
    with sessions(client)() as session:
        assert session.scalars(select(MetadataDecision)).all() == []


def test_running_it_again_adds_nothing(client):
    document = stored(client)
    repair(sessions(client), apply=True)
    rows = date_rows(client, document)
    report = repair(sessions(client), apply=True)
    assert not report.safe and report.uncertain == {"not_the_current_reading": 1}
    assert date_rows(client, document) == rows


@pytest.mark.parametrize("head", ["The only date on the first page, with no label saying what it means.", 'Found 2 different dates labeled "date of service". Showing the first.'])
def test_other_doubts_keep_their_words_and_stay_low(client, head):
    document = stored(client, reason=head + DOUBT)
    assert repair(sessions(client), apply=True).safe == {"low": 1}
    proposal = date_field(client, document)["proposal"]
    assert proposal["confidence"] == "low" and proposal["reason"] == head


def test_a_two_digit_year_keeps_its_warning(client):
    document = stored(client, snippet="Date of service: 03/11/24")
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"two_digit_year": 1} and not report.safe
    assert "two ways" in date_field(client, document)["proposal"]["reason"]


def test_a_person_decision_is_left_alone(client):
    document = stored(client)
    proposal = date_field(client, document)["proposal"]["id"]
    assert client.post(f"/api/documents/{document}/metadata/service_date", json={"action": "confirmed", "proposal_id": proposal}, headers=CLIENT_HEADERS).status_code == 200
    rows = date_rows(client, document)
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"already_decided": 1} and date_rows(client, document) == rows
    with sessions(client)() as session:
        assert [d.action for d in session.scalars(select(MetadataDecision))] == [DecisionAction.CONFIRMED]


def test_an_older_reading_is_kept_as_it_is(client):
    document = stored(client)
    with sessions(client)() as session:
        old = session.scalars(select(ExtractionRun).where(ExtractionRun.document_id == document)).one()
        session.add(ExtractionRun(document_id=document, method=old.method, status=old.status, finished_at=old.finished_at, page_count=old.page_count, pages_read=1, pages_with_text=1, proposals=[MetadataProposal(field=p.field, value=p.value, confidence=p.confidence, reason=p.reason, source_page=p.source_page, source_snippet=p.source_snippet) for p in old.proposals]))
        session.commit()
    before = date_rows(client, document)
    report = repair(sessions(client), apply=True)
    assert report.safe == {"high": 1} and report.uncertain == {"not_the_current_reading": 1}
    assert date_rows(client, document)[:2] == before and len(date_rows(client, document)) == 3
    assert date_field(client, document)["proposal"]["confidence"] == "high"


@pytest.mark.parametrize("over, why", [
    ({"snippet": "Date of service: 05/06/2024"}, "stored_line_does_not_confirm_it"),
    ({"reason": "Some other reason." + DOUBT}, "unknown_reason"),
    ({"value": "2024-11-03", "snippet": "Date of service: 11/03/2024"}, "not_the_expected_warning"),
    ({"reason": LABELED + " The numbers could be read two ways: 2024-03-11."}, "not_the_expected_warning"),
])
def test_anything_that_cannot_be_shown_to_fit_is_left_alone(client, over, why):
    document = stored(client, **over)
    rows = date_rows(client, document)
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {why: 1} and not report.safe and date_rows(client, document) == rows


def test_a_warning_without_this_sentence_is_not_a_candidate(client):
    document = stored(client, reason=LABELED + " The year is written with two digits.", snippet="Date of service: 03/11/24")
    assert repair(sessions(client), apply=True).candidates == 0
    assert "two digits" in date_field(client, document)["proposal"]["reason"]


def test_a_failure_partway_changes_nothing(client, monkeypatch):
    first, second = stored(client), None
    second = upload(client, pdfs.text_pdf(["Fictional Clinic", "Date of service: 04/10/2024", "Second"]), "second.pdf").json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    with sessions(client)() as session:
        p = next(x for x in session.scalars(select(ExtractionRun).where(ExtractionRun.document_id == second)).one().proposals if x.field is MetadataField.SERVICE_DATE)
        p.reason, p.confidence = LABELED + " The numbers could be read two ways: 2024-04-10 or 2024-10-04.", Confidence.LOW
        session.commit()
    before = date_rows(client, first), date_rows(client, second)
    calls = []
    real = module.MetadataProposal

    def fails_second_time(**fields):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("fictional failure")
        return real(**fields)

    monkeypatch.setattr(module, "MetadataProposal", fails_second_time)
    with pytest.raises(RuntimeError):
        repair(sessions(client), apply=True)
    assert (date_rows(client, first), date_rows(client, second)) == before
