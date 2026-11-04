"""Correcting confidence on stored results after the collection date bug. Every record here is fictional."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from this_is_you import lab_confidence_repair as repair_module
from this_is_you.lab_confidence_repair import repair, repair_date_doubt
from this_is_you.models import Confidence, ExtractionRun, Observation, ObservationExtraction

from . import pdfs
from .conftest import CLIENT_HEADERS, upload

TABLE = ["Fictional Portal", "Component Your Value Standard Range Flag"]
LATE = ["Collected on Mar 5, 2024 9:12 AM", "Result Date: Mar 6, 2024"]
CLEAN = ["WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL", "Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL"]
FIELDS = ("reported_name", "value_text", "unit", "reference_text", "flag", "collected_on", "reported_on", "documented_on", "value_number", "reference_low", "reference_high", "test_code", "verification_status", "source_page", "source_line", "source_text", "issues")


def as_the_bug_left_it(client, lines, name="fictional.pdf"):
    """Reads a report, then marks its clean rows low, exactly as the old parser stored them."""
    document = upload(client, pdfs.text_pdf(lines), name).json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    with client.app.state.sessions() as session:
        session.execute(update(Observation).where(Observation.document_id == document).values(confidence=Confidence.LOW))
        session.commit()
    return document


def rows(client, document):
    return [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == document]


def named(client, document, name):
    return next(o for o in rows(client, document) if o["reported_name"] == name)


def sessions(client):
    return client.app.state.sessions


def test_a_dry_run_changes_nothing(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    before = rows(client, document)
    report = repair(sessions(client))
    assert (report.candidates, dict(report.safe), dict(report.uncertain)) == (2, {"high": 2}, {})
    assert rows(client, document) == before


def test_applying_changes_only_confidence_and_keeps_the_history(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    before = {o["id"]: o for o in rows(client, document)}
    assert repair(sessions(client), apply=True).safe == {"high": 2}
    after = rows(client, document)
    with sessions(client)() as session:
        confidence = {o.id: o.confidence for o in session.scalars(select(Observation).where(Observation.document_id == document))}
    for o in after:
        was = before[o["id"]]
        assert confidence[o["id"]] is Confidence.HIGH
        assert all(o[k] == was[k] for k in FIELDS if k in was)
        assert o["verification_status"] == "proposed" and o["approved_group_id"] is None and o["edited"] is False
        assert o["revisions"][:-1] == was["revisions"]
        fix = o["revisions"][-1]
        assert fix["action"] == "parser_fix"
        assert fix["values"]["parser_fix"]["previous_confidence"] == "low" and fix["values"]["parser_fix"]["new_confidence"] == "high"
        assert "not a person" in fix["values"]["parser_fix"]["recorded_as"] and fix["values"]["parser_fix"]["reason"]
        assert fix["values"]["verification_status"] == "proposed"


def test_a_row_with_no_range_returns_to_medium_not_high(client):
    document = as_the_bug_left_it(client, TABLE + ["WBC 6.2 x10E3/uL"] + LATE)
    assert repair(sessions(client), apply=True).safe == {"medium": 1}
    assert named(client, document, "WBC")["revisions"][-1]["values"]["parser_fix"]["new_confidence"] == "medium"


def test_running_it_again_finds_nothing(client):
    as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    repair(sessions(client), apply=True)
    assert repair(sessions(client), apply=True).candidates == 0


def test_a_warning_means_it_is_not_even_a_candidate(client):
    document = as_the_bug_left_it(client, TABLE + ["WBC 6.2"] + LATE)
    assert repair(sessions(client), apply=True).candidates == 0
    assert named(client, document, "WBC")["revisions"][-1]["action"] == "extracted"


def set_low(client):
    with sessions(client)() as session:
        session.execute(update(Observation).values(confidence=Confidence.LOW))
        session.commit()


def test_a_corrected_result_is_left_alone(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    client.post(f"/api/observations/{named(client, document, 'WBC')['id']}/correct", json={"fields": {"lab_name": "Fictional Lab"}}, headers=CLIENT_HEADERS)
    with sessions(client)() as session:
        o = session.scalars(select(Observation).where(Observation.reported_name == "WBC")).one()
        o.confidence, o.issues = Confidence.LOW, []
        session.commit()
    report = repair(sessions(client), apply=True)
    assert report.uncertain["changed_since_reading"] == 1 and report.safe == {"high": 1}


def test_a_decided_result_is_left_alone(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    client.post(f"/api/observations/{named(client, document, 'WBC')['id']}/verify", headers=CLIENT_HEADERS)
    report = repair(sessions(client), apply=True)
    assert report.uncertain["already_decided"] == 1 and report.safe == {"high": 1}


def test_an_unknown_parser_version_is_left_alone(client):
    as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    with sessions(client)() as session:
        session.execute(update(ExtractionRun).values(method="rules-v1"))
        session.commit()
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"unknown_parser_version": 2} and not report.safe


def test_several_dates_in_one_reading_are_left_alone(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    with sessions(client)() as session:
        session.scalars(select(Observation).where(Observation.document_id == document, Observation.reported_name == "WBC")).one().collected_on = "2024-04-09"
        session.commit()
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"not_one_collection_date": 2}


def test_a_source_line_that_does_not_confirm_it_is_left_alone(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    with sessions(client)() as session:
        session.scalars(select(Observation).where(Observation.document_id == document, Observation.reported_name == "WBC")).one().source_text = "WBC 9.9 x10E3/uL 3.4 - 10.8 x10E3/uL"
        session.commit()
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"source_line_does_not_confirm_it": 1} and report.safe == {"high": 1}


def test_a_clean_row_earlier_in_the_report_shows_the_date_came_first(client):
    document = as_the_bug_left_it(client, TABLE + LATE + CLEAN)
    with sessions(client)() as session:
        session.scalars(select(Observation).where(Observation.document_id == document, Observation.reported_name == "WBC")).one().confidence = Confidence.HIGH
        session.commit()
    report = repair(sessions(client), apply=True)
    assert report.uncertain == {"date_came_before_this_row": 1} and not report.safe


def test_a_failure_partway_changes_nothing(client, monkeypatch):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    before = rows(client, document)
    calls = []
    real = repair_module._snapshot

    def fails_second_time(o):
        calls.append(o.id)
        if len(calls) == 2:
            raise RuntimeError("fictional failure")
        return real(o)

    monkeypatch.setattr(repair_module, "_snapshot", fails_second_time)
    with pytest.raises(RuntimeError):
        repair(sessions(client), apply=True)
    assert len(calls) == 2 and rows(client, document) == before
    with sessions(client)() as session:
        assert {o.confidence for o in session.scalars(select(Observation))} == {Confidence.LOW}


def test_corrected_results_can_join_a_group_but_stay_unapproved_until_approved_and_undo_works(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    assert [o for o in rows(client, document) if o["group_eligible"]] == []
    repair(sessions(client), apply=True)
    shown = [o for o in rows(client, document) if o["group_eligible"]]
    assert len(shown) == 2 and all(o["verification_status"] == "proposed" for o in shown)
    body = {"document_id": document, "group": shown[0]["review_group"], "collected_on": shown[0]["collected_on"], "items": [{"id": o["id"], "version": o["version"]} for o in shown]}
    approved = client.post("/api/observations/approve-group", json=body, headers=CLIENT_HEADERS)
    assert approved.status_code == 200, approved.text
    assert {o["verification_status"] for o in rows(client, document)} == {"verified"}
    group = rows(client, document)[0]["approved_group_id"]
    assert client.post(f"/api/observations/group-approvals/{group}/undo", headers=CLIENT_HEADERS).status_code == 200
    after = rows(client, document)
    assert {o["verification_status"] for o in after} == {"proposed"}
    assert [r["action"] for r in after[0]["revisions"]][:2] == ["extracted", "parser_fix"] and len(after[0]["revisions"]) == 4


def test_an_old_approved_body_after_the_fix_is_refused_as_stale(client):
    document = as_the_bug_left_it(client, TABLE + CLEAN + LATE)
    with sessions(client)() as session:
        session.execute(update(Observation).values(confidence=Confidence.HIGH))
        session.commit()
    shown = [o for o in rows(client, document) if o["group_eligible"]]
    set_low(client)
    repair(sessions(client), apply=True)
    body = {"document_id": document, "group": shown[0]["review_group"], "collected_on": shown[0]["collected_on"], "items": [{"id": o["id"], "version": o["version"]} for o in shown]}
    assert client.post("/api/observations/approve-group", json=body, headers=CLIENT_HEADERS).status_code == 409


# ---- The warning that a date could be read two ways, as older readings stored it.

DOUBT = "This date could be read two ways: 2024-03-05 or 2024-05-03."
DATED = ["Collected on Mar 5, 2024 9:12 AM", *TABLE, *CLEAN]


def as_older_readings_left_it(client, lines=DATED, extra=()):
    document = upload(client, pdfs.text_pdf(lines), "fictional.pdf").json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    with sessions(client)() as session:
        for o in session.scalars(select(Observation).where(Observation.document_id == document)):
            o.issues, o.confidence, o.extraction_status = [*extra, *o.issues, DOUBT], Confidence.LOW, ObservationExtraction.AMBIGUOUS
        session.commit()
    return document


def test_a_dry_run_of_the_date_repair_changes_nothing(client):
    document = as_older_readings_left_it(client)
    before = rows(client, document)
    report = repair_date_doubt(sessions(client))
    assert (report.candidates, dict(report.safe), dict(report.uncertain)) == (2, {"high": 2}, {})
    assert rows(client, document) == before


def test_clearing_the_date_doubt_changes_only_the_warning_and_confidence(client):
    document = as_older_readings_left_it(client)
    before = {o["id"]: o for o in rows(client, document)}
    assert repair_date_doubt(sessions(client), apply=True).safe == {"high": 2}
    for o in rows(client, document):
        was = before[o["id"]]
        assert o["issues"] == [] and was["extraction_status"] == "ambiguous" and o["extraction_status"] == "parsed"
        assert all(o[k] == was[k] for k in FIELDS if k in was and k != "issues")
        assert o["verification_status"] == "proposed" and o["approved_group_id"] is None and o["edited"] is False
        assert o["group_eligible"] is True
        assert o["revisions"][:-1] == was["revisions"]
        fix = o["revisions"][-1]
        assert fix["action"] == "parser_fix"
        assert fix["values"]["parser_fix"]["removed_warnings"] == [DOUBT] and "not a person" in fix["values"]["parser_fix"]["recorded_as"]
    assert repair_date_doubt(sessions(client), apply=True).candidates == 0


def test_other_warnings_stay_and_keep_it_low(client):
    other = "No unit was printed on this line. None was assumed."
    document = as_older_readings_left_it(client, extra=[other])
    assert repair_date_doubt(sessions(client), apply=True).safe == {"low": 2}
    o = named(client, document, "WBC")
    assert o["issues"] == [other] and o["group_eligible"] is False and o["extraction_status"] == "ambiguous"
    with sessions(client)() as session:
        assert {x.confidence for x in session.scalars(select(Observation))} == {Confidence.LOW}


def test_the_date_repair_leaves_decided_and_edited_results_alone(client):
    document = as_older_readings_left_it(client)
    client.post(f"/api/observations/{named(client, document, 'WBC')['id']}/verify", headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{named(client, document, 'Hemoglobin')['id']}/correct", json={"fields": {"lab_name": "Fictional Lab"}}, headers=CLIENT_HEADERS)
    with sessions(client)() as session:  # A correction clears warnings, so put it back to test the history check alone.
        session.scalars(select(Observation).where(Observation.reported_name == "Hemoglobin")).one().issues = [DOUBT]
        session.commit()
    report = repair_date_doubt(sessions(client), apply=True)
    assert dict(report.uncertain) == {"already_decided": 1, "changed_since_reading": 1} and not report.safe
    assert DOUBT in named(client, document, "WBC")["issues"] and DOUBT in named(client, document, "Hemoglobin")["issues"]


def test_a_stored_date_that_is_not_the_month_first_reading_is_left_alone(client):
    document = as_older_readings_left_it(client)
    with sessions(client)() as session:
        session.scalars(select(Observation).where(Observation.reported_name == "WBC")).one().collected_on = "2024-05-03"
        session.commit()
    report = repair_date_doubt(sessions(client), apply=True)
    assert report.uncertain == {"stored_date_is_not_the_month_first_reading": 1} and report.safe == {"high": 1}
    assert DOUBT in named(client, document, "WBC")["issues"]


def test_a_source_line_that_does_not_confirm_the_date_repair_is_left_alone(client):
    as_older_readings_left_it(client)
    with sessions(client)() as session:
        session.scalars(select(Observation).where(Observation.reported_name == "WBC")).one().source_text = "WBC 9.9 x10E3/uL 3.4 - 10.8 x10E3/uL"
        session.commit()
    report = repair_date_doubt(sessions(client), apply=True)
    assert report.uncertain == {"source_line_does_not_confirm_it": 1} and report.safe == {"high": 1}


def test_a_failure_partway_through_the_date_repair_changes_nothing(client, monkeypatch):
    document = as_older_readings_left_it(client)
    before = rows(client, document)
    calls = []
    real = repair_module._snapshot

    def fails_second_time(o):
        calls.append(o.id)
        if len(calls) == 2:
            raise RuntimeError("fictional failure")
        return real(o)

    monkeypatch.setattr(repair_module, "_snapshot", fails_second_time)
    with pytest.raises(RuntimeError):
        repair_date_doubt(sessions(client), apply=True)
    assert rows(client, document) == before
