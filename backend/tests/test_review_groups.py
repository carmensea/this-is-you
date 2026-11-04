"""Approving a table of results together. Every record here is fictional."""
from __future__ import annotations

import threading

import pytest

from this_is_you import observations as service

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, upload

HEAD = ["Fictional Portal", "Patient: Avery Testperson", "Collected on Mar 5, 2024 9:12 AM", "Result Date: Mar 6, 2024", "Component Your Value Standard Range Flag"]
CBC = ["WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL", "Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL", "Platelets 451 x10E3/uL 150 - 450 x10E3/uL High", "MCV 89 fL 79 - 97 fL"]
METABOLIC = ["Glucose 90 mg/dL 65 - 99 mg/dL", "Sodium 140 mmol/L 134 - 144 mmol/L"]
DOUBTFUL = ["Fictional Marker Alpha 12", "RBC", "4.61", "3.77 - 5.28", "Hematocrit 41.2 %"]


def read(client, lines, name="fictional.pdf") -> str:
    document = upload(client, pdfs.text_pdf(lines), name).json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    return document


def rows(client, document=None) -> list[dict]:
    found = client.get("/api/observations").json()["observations"]
    return [o for o in found if document is None or o["document_id"] == document]


def named(client, name):
    return next(o for o in rows(client) if o["reported_name"] == name)


def eligible(client, document, category="Complete blood count"):
    return [o for o in rows(client, document) if o["group_eligible"] and o["review_group_label"] == category]


def body(document, shown):
    return {"document_id": document, "group": shown[0]["review_group"], "collected_on": shown[0]["collected_on"], "items": [{"id": o["id"], "version": o["version"]} for o in shown]}


def approve(client, document, shown):
    return client.post("/api/observations/approve-group", json=body(document, shown), headers=CLIENT_HEADERS)


# ---- What goes in a group

def test_groups_keep_categories_and_dates_apart(client):
    document = read(client, HEAD + CBC + METABOLIC)
    assert len(eligible(client, document)) == 4 and len(eligible(client, document, "Metabolic panel")) == 2
    assert len({o["review_group"] for o in rows(client, document)}) == 2


def test_each_document_has_its_own_groups(client):
    first, second = read(client, HEAD + CBC, "a.pdf"), read(client, HEAD + CBC[:2] + ["Fictional distinct line one"], "b.pdf")
    shown = eligible(client, first)
    assert approve(client, second, shown).status_code == 409
    assert [o for o in rows(client) if o["verification_status"] == "verified"] == []
    assert first != second


def test_two_collections_on_one_day_are_not_merged_when_the_report_tells_them_apart(client):
    lines = HEAD + CBC[:2] + ["Collected on Mar 5, 2024 5:40 PM"] + ["MCV 91 fL 79 - 97 fL", "Platelets 300 x10E3/uL 150 - 450 x10E3/uL"]
    document = read(client, lines)
    groups = {o["reported_name"]: o["review_group"] for o in rows(client, document)}
    assert groups["WBC"] == groups["Hemoglobin"] and groups["MCV"] == groups["Platelets"] and groups["WBC"] != groups["MCV"]


def test_a_repeated_page_heading_does_not_split_a_group(client):
    document = read(client, HEAD + CBC[:2] + HEAD + CBC[2:])
    assert len({o["review_group"] for o in rows(client, document)}) == 1


def test_a_test_appearing_twice_with_nothing_telling_them_apart_goes_to_individual_review(client):
    document = read(client, HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8", "WBC 7.9 x10E3/uL 3.4 - 10.8", "MCV 89 fL 79 - 97"])
    both = [o for o in rows(client, document) if o["reported_name"] == "WBC"]
    assert len(both) == 2 and not any(o["group_eligible"] for o in both)
    assert all(any("more than once" in r for r in o["group_reasons"]) for o in both)
    assert named(client, "MCV")["group_eligible"] is True


@pytest.mark.parametrize("line,reason", [
    ("Fictional Marker Alpha 12", "not in the known list"),
    ("Hematocrit 41.2 %", "No reference range"),
    ("Glucose 90 65 - 99", "No unit"),
    ("TSH <0.01 mIU/L 0.45 - 4.50", "not one exact number"),
])
def test_anything_missing_or_uncertain_goes_to_individual_review(client, line, reason):
    read(client, HEAD + [line])
    row = rows(client)[0]
    assert row["group_eligible"] is False and any(reason in r for r in row["group_reasons"])


def test_a_row_with_no_collection_date_goes_to_individual_review(client):
    read(client, ["Component Your Value Standard Range Flag", "WBC 6.2 x10E3/uL 3.4 - 10.8"])
    assert rows(client)[0]["group_eligible"] is False


def test_a_row_with_no_value_goes_to_individual_review(client):
    read(client, HEAD + ["Hemoglobin", "Standard Range: 11.1 - 15.9 g/dL"])
    assert rows(client)[0]["group_eligible"] is False


def test_a_printed_flag_does_not_block_a_group(client):
    read(client, HEAD + CBC)
    assert named(client, "Platelets")["flag"] == "High" and named(client, "Platelets")["group_eligible"] is True


def test_results_typed_by_hand_are_approved_alone(client):
    document = read(client, HEAD + CBC)
    client.post("/api/observations", json={"fields": {"reported_name": "Glucose", "value_text": "90", "unit": "mg/dL", "reference_text": "65-99", "collected_on": "2024-03-05"}, "document_id": document}, headers=CLIENT_HEADERS)
    assert named(client, "Glucose")["group_eligible"] is False


def test_nothing_is_approved_by_reading_or_listing(client):
    document = read(client, HEAD + CBC)
    for _ in range(2):
        assert all(o["verification_status"] == "proposed" for o in rows(client, document))


# ---- Approving the exact set

def test_approval_applies_to_the_set_and_records_its_provenance(client):
    document = read(client, HEAD + CBC + DOUBTFUL)
    shown = eligible(client, document)
    assert approve(client, document, shown).status_code == 200
    ids = {o["id"] for o in shown}
    group_ids = set()
    for o in rows(client, document):
        if o["id"] in ids:
            assert o["verification_status"] == "verified" and o["approved_group_id"]
            last = o["revisions"][-1]
            assert last["action"] == "verified" and last["review_group_id"] == o["approved_group_id"] and last["occurred_at"]
            group_ids.add(o["approved_group_id"])
        else:
            assert o["verification_status"] == "proposed"
    assert len(group_ids) == 1


@pytest.mark.parametrize("change", ["drop", "add_unknown", "repeat", "wrong_date", "wrong_group", "old_version", "empty"])
def test_any_set_other_than_the_one_shown_is_refused_whole(client, change):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    sent = body(document, shown)
    if change == "drop":
        sent["items"] = sent["items"][1:]
    elif change == "add_unknown":
        sent["items"].append({"id": "f" * 32, "version": 1})
    elif change == "repeat":
        sent["items"].append(sent["items"][0])
    elif change == "wrong_date":
        sent["collected_on"] = "2020-01-01"
    elif change == "wrong_group":
        sent["group"] = "2024-03-05|cmp|0"
    elif change == "old_version":
        sent["items"][0]["version"] -= 1
    elif change == "empty":
        sent["items"] = []
    answer = client.post("/api/observations/approve-group", json=sent, headers=CLIENT_HEADERS)
    assert answer.status_code in (409, 422)
    assert all(o["verification_status"] == "proposed" and not o["approved_group_id"] for o in rows(client, document))


def test_a_row_edited_after_it_was_shown_stops_the_whole_group(client):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    client.post(f"/api/observations/{shown[0]['id']}/correct", json={"fields": {"value_text": "7.0"}}, headers=CLIENT_HEADERS)
    answer = approve(client, document, shown)
    assert answer.status_code == 409 and answer.json()["code"] == "group_changed" and "nothing was approved" in answer.json()["message"]
    assert all(o["verification_status"] == "proposed" for o in rows(client, document))


def test_a_row_accepted_or_rejected_alone_after_it_was_shown_stops_the_group(client):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    client.post(f"/api/observations/{shown[1]['id']}/reject", headers=CLIENT_HEADERS)
    assert approve(client, document, shown).status_code == 409
    assert [o for o in rows(client, document) if o["verification_status"] == "verified"] == []


def test_a_result_arriving_after_the_group_was_shown_stops_it(client):
    from this_is_you.models import Document

    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    sessions = client.app.state.sessions
    with sessions() as session:
        service.add_extracted_rows(session, session.get(Document, document), None, [{"name": "RBC", "value": "4.6", "unit": "x10E6/uL", "reference": "3.7-5.2", "flag": None, "collected": "2024-03-05", "reported": None, "page": 1, "line": 40, "source": "RBC 4.6", "confidence": "high", "issues": [], "section": 0}])
        session.commit()
    assert approve(client, document, shown).status_code == 409


def test_a_group_can_be_shown_again_and_approved_after_a_refusal(client):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    client.post(f"/api/observations/{shown[0]['id']}/correct", json={"fields": {"value_text": "7.0"}}, headers=CLIENT_HEADERS)
    assert approve(client, document, shown).status_code == 409
    fresh = eligible(client, document)
    assert len(fresh) == 4 and approve(client, document, fresh).status_code == 200


def test_a_failure_partway_leaves_nothing_approved(client, monkeypatch):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    real, calls = service._revise, []

    def fail_on_third(*args, **kwargs):
        calls.append(1)
        if len(calls) == 3:
            raise RuntimeError("simulated failure")
        return real(*args, **kwargs)

    monkeypatch.setattr(service, "_revise", fail_on_third)
    with pytest.raises(RuntimeError):
        approve(client, document, shown)
    monkeypatch.undo()
    after = rows(client, document)
    assert all(o["verification_status"] == "proposed" and not o["approved_group_id"] and len(o["revisions"]) == 1 for o in after)
    assert approve(client, document, eligible(client, document)).status_code == 200


def test_two_identical_approvals_at_once_approve_only_once(client):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    answers: list[int] = []
    threads = [threading.Thread(target=lambda: answers.append(approve(client, document, shown).status_code)) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(answers) == [200, 409, 409, 409]
    assert all(len(o["revisions"]) == 2 for o in rows(client, document))


def test_an_edit_racing_an_approval_never_leaves_a_changed_value_approved(client):
    for attempt in range(25):
        document = read(client, HEAD + CBC + [f"Fictional distinct line {attempt}"], f"{attempt}.pdf")
        shown = eligible(client, document)
        target = shown[0]["id"]
        threads = [
            threading.Thread(target=lambda: approve(client, document, shown)),
            threading.Thread(target=lambda: client.post(f"/api/observations/{target}/correct", json={"fields": {"value_text": f"9.{attempt}"}}, headers=CLIENT_HEADERS)),
        ]
        [t.start() for t in threads]
        [t.join() for t in threads]
        row = next(o for o in rows(client, document) if o["id"] == target)
        if row["verification_status"] == "verified":
            assert row["value_text"] == shown[0]["value_text"] and row["approved_group_id"]
        else:
            assert row["approved_group_id"] is None


# ---- Corrections in the table

def test_a_corrected_row_stays_in_the_table_and_needs_approving(client):
    document = read(client, HEAD + CBC)
    wbc = named(client, "WBC")
    client.post(f"/api/observations/{wbc['id']}/correct", json={"fields": {"value_text": "6.3"}}, headers=CLIENT_HEADERS)
    after = named(client, "WBC")
    assert after["group_eligible"] is True and after["verification_status"] == "proposed" and after["version"] > wbc["version"]
    assert approve(client, document, eligible(client, document)).status_code == 200
    final = named(client, "WBC")
    assert final["value_text"] == "6.3" and final["original"]["value_text"] == "6.2"


def test_correcting_a_doubtful_row_brings_it_into_the_table(client):
    read(client, HEAD + ["Hematocrit 41.2 %"])
    row = rows(client)[0]
    assert row["group_eligible"] is False
    client.post(f"/api/observations/{row['id']}/correct", json={"fields": {"reference_text": "34.0-46.6"}}, headers=CLIENT_HEADERS)
    assert rows(client)[0]["group_eligible"] is True


def test_a_correction_that_removes_something_takes_a_row_out_of_the_table(client):
    read(client, HEAD + CBC)
    wbc = named(client, "WBC")
    client.post(f"/api/observations/{wbc['id']}/correct", json={"fields": {"unit": None}}, headers=CLIENT_HEADERS)
    assert named(client, "WBC")["group_eligible"] is False


def test_individual_approval_still_works_and_records_no_group(client):
    read(client, HEAD + CBC)
    wbc = named(client, "WBC")
    assert client.post(f"/api/observations/{wbc['id']}/verify", headers=CLIENT_HEADERS).status_code == 200
    after = named(client, "WBC")
    assert after["verification_status"] == "verified" and after["approved_group_id"] is None and after["revisions"][-1]["review_group_id"] is None


# ---- Undo

def group_id(client, name="WBC"):
    return named(client, name)["approved_group_id"]


def test_undo_returns_the_results_to_review_and_keeps_all_history(client):
    document = read(client, HEAD + CBC)
    approve(client, document, eligible(client, document))
    gid = group_id(client)
    answer = client.post(f"/api/observations/group-approvals/{gid}/undo", headers=CLIENT_HEADERS)
    assert answer.status_code == 200
    for o in rows(client, document):
        assert o["verification_status"] == "proposed" and o["approved_group_id"] is None and o["group_eligible"] is True
        assert [r["action"] for r in o["revisions"]] == ["extracted", "verified", "reopened"]
        assert o["revisions"][1]["review_group_id"] == gid and o["revisions"][2]["review_group_id"] == gid


def test_undo_can_only_happen_once_and_a_new_approval_is_a_new_group(client):
    document = read(client, HEAD + CBC)
    approve(client, document, eligible(client, document))
    gid = group_id(client)
    client.post(f"/api/observations/group-approvals/{gid}/undo", headers=CLIENT_HEADERS)
    assert client.post(f"/api/observations/group-approvals/{gid}/undo", headers=CLIENT_HEADERS).status_code == 409
    assert approve(client, document, eligible(client, document)).status_code == 200
    assert group_id(client) != gid
    assert [r["action"] for r in named(client, "WBC")["revisions"]] == ["extracted", "verified", "reopened", "verified"]


def test_undo_leaves_a_result_changed_by_hand_since_as_it_is(client):
    document = read(client, HEAD + CBC)
    approve(client, document, eligible(client, document))
    gid = group_id(client)
    hgb, mcv = named(client, "Hemoglobin"), named(client, "MCV")
    client.post(f"/api/observations/{mcv['id']}/reject", headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{hgb['id']}/correct", json={"fields": {"value_text": "14.0"}}, headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{hgb['id']}/verify", headers=CLIENT_HEADERS)
    client.post(f"/api/observations/group-approvals/{gid}/undo", headers=CLIENT_HEADERS)
    assert named(client, "MCV")["verification_status"] == "rejected"
    assert named(client, "Hemoglobin")["verification_status"] == "verified" and named(client, "Hemoglobin")["value_text"] == "14.0"
    assert named(client, "WBC")["verification_status"] == "proposed"


def test_undoing_an_unknown_group_is_a_404(client):
    assert client.post(f"/api/observations/group-approvals/{'f' * 32}/undo", headers=CLIENT_HEADERS).status_code == 404


def test_approved_results_reach_the_charts_and_undone_ones_leave(client):
    document = read(client, HEAD + CBC)
    approve(client, document, eligible(client, document))
    assert sum(o["verification_status"] == "verified" for o in rows(client, document)) == 4
    client.post(f"/api/observations/group-approvals/{group_id(client)}/undo", headers=CLIENT_HEADERS)
    assert sum(o["verification_status"] == "verified" for o in rows(client, document)) == 0


# ---- Lasting, and safe

def test_everything_survives_a_restart(data_dir):
    client = client_for(data_dir)
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    approve(client, document, shown)
    gid = group_id(client)
    again = client_for(data_dir)
    assert group_id(again) == gid and named(again, "WBC")["verification_status"] == "verified"
    assert again.post(f"/api/observations/group-approvals/{gid}/undo", headers=CLIENT_HEADERS).status_code == 200
    third = client_for(data_dir)
    assert named(third, "WBC")["verification_status"] == "proposed"
    fresh = eligible(third, document)
    assert approve(third, document, fresh).status_code == 200


def test_a_set_shown_before_a_restart_is_refused_if_anything_changed_during_it(data_dir):
    client = client_for(data_dir)
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    client.post(f"/api/observations/{shown[0]['id']}/correct", json={"fields": {"value_text": "7.0"}}, headers=CLIENT_HEADERS)
    assert approve(client_for(data_dir), document, shown).status_code == 409


def test_restarting_does_not_read_documents_again_or_touch_existing_results(data_dir):
    client = client_for(data_dir)
    document = read(client, HEAD + CBC)
    wbc = named(client, "WBC")
    client.post(f"/api/observations/{wbc['id']}/verify", headers=CLIENT_HEADERS)
    runs = len(client.get(f"/api/documents/{document}").json()["runs"])
    before = rows(client, document)
    again = client_for(data_dir)
    again.app.state.extraction.wait_idle()
    assert len(again.get(f"/api/documents/{document}").json()["runs"]) == runs
    assert [(o["id"], o["version"], o["verification_status"]) for o in rows(again, document)] == [(o["id"], o["version"], o["verification_status"]) for o in before]


def test_group_approval_needs_the_app_header_and_a_session(client, data_dir):
    document = read(client, HEAD + CBC)
    shown = eligible(client, document)
    assert client.post("/api/observations/approve-group", json=body(document, shown)).status_code == 403
    client.cookies.clear()
    assert approve(client, document, shown).status_code == 401
    assert client.post(f"/api/observations/group-approvals/{'f' * 32}/undo", headers=CLIENT_HEADERS).status_code == 401


def test_group_approvals_are_in_backups(client, data_dir, tmp_path):
    from this_is_you.backup import create_backup, verify_backup

    document = read(client, HEAD + CBC)
    approve(client, document, eligible(client, document))
    result = create_backup(data_dir / "archive.sqlite3", data_dir / "originals", tmp_path / "out")
    check = verify_backup(result.path)
    assert check.ok and check.manifest["counts"]["review_group_approvals"] == 1


def test_upgrading_keeps_verified_results_decisions_history_and_reads_nothing_again(data_dir):
    from alembic import command

    from this_is_you import db

    client = client_for(data_dir)
    document = read(client, HEAD + CBC)
    wbc, hgb = named(client, "WBC"), named(client, "Hemoglobin")
    client.post(f"/api/observations/{wbc['id']}/correct", json={"fields": {"value_text": "6.3"}}, headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{wbc['id']}/verify", headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{hgb['id']}/reject", headers=CLIENT_HEADERS)
    client.post(f"/api/documents/{document}/metadata/provider", json={"action": "corrected", "value": "Fictional Clinic"}, headers=CLIENT_HEADERS)
    before = {o["id"]: (o["verification_status"], o["value_text"], [r["action"] for r in o["revisions"]]) for o in rows(client)}
    runs = len(client.get(f"/api/documents/{document}").json()["runs"])
    client.app.state.extraction.wait_idle()
    db.run_migration(client.app.state.engine, lambda config: command.downgrade(config, "0005"))
    client.app.state.engine.dispose()

    again = client_for(data_dir)
    again.app.state.extraction.wait_idle()
    assert {o["id"]: (o["verification_status"], o["value_text"], [r["action"] for r in o["revisions"]]) for o in rows(again)} == before
    assert len(again.get(f"/api/documents/{document}").json()["runs"]) == runs
    decided = again.get(f"/api/documents/{document}").json()["metadata"]["provider"]
    assert decided["value"] == "Fictional Clinic"
    assert list(data_dir.glob("archive.sqlite3.before-upgrade-*"))
    assert all(o["approved_group_id"] is None for o in rows(again))
