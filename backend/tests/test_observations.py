from __future__ import annotations

import logging

import pytest
from sqlalchemy import text

from this_is_you.models import Document, ExtractionRun
from this_is_you.extraction import METHOD

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, upload


def imported(client, lines, name="report.pdf"):
    response = upload(client, pdfs.text_pdf(lines), name)
    assert response.status_code in (200, 201), response.text
    client.app.state.extraction.wait_idle()
    return response.json()["document"]["id"]


def rows(client, document_id=None):
    all_rows = client.get("/api/observations").json()["observations"]
    return [o for o in all_rows if document_id is None or o["document_id"] == document_id]


def named(client, document_id, name):
    return next(o for o in rows(client, document_id) if o["reported_name"] == name)


def post(client, path, body=None):
    return client.post(path, json=body or {}, headers=CLIENT_HEADERS)


def verified(client):
    return [o for o in rows(client) if o["verification_status"] == "verified"]


def test_extraction_only_proposes(client):
    doc = imported(client, pdfs.CBC_VALUE_UNIT_RANGE)
    found = rows(client, doc)
    assert len(found) == 7
    assert all(o["verification_status"] == "proposed" and o["origin"] == "extracted" for o in found)
    assert verified(client) == []


def test_all_required_detail_is_preserved(client):
    doc = imported(client, pdfs.CBC_VALUE_UNIT_RANGE)
    o = named(client, doc, "Hemoglobin")
    assert o["value_text"] == "14.20" and o["value_number"] == 14.2
    assert (o["unit"], o["normalized_value"], o["normalized_unit"]) == ("g/dL", 14.2, "g/dL")
    assert (o["reference_text"], o["reference_low"], o["reference_high"]) == ("13.0-17.7", 13.0, 17.7)
    assert o["test_code"] == "hgb" and o["code_system"] == "this-is-you-v1"
    assert (o["collected_on"], o["reported_on"], o["documented_on"]) == ("2024-03-28", "2024-03-30", "2024-03-30")
    assert o["imported_at"].endswith("Z") and o["imported_at"][:4] != "2024"
    assert (o["source_page"], o["source_text"]) == (1, "Hemoglobin 14.20 g/dL 13.0-17.7")
    assert o["extraction_status"] == "parsed" and o["document_id"] == doc
    assert named(client, doc, "Platelets")["flag"] == "H"


def test_unknown_collection_date_is_never_replaced_by_another_date(client):
    doc = imported(client, ["Laboratory Report", "Reported: 2024-03-30", "Hemoglobin 14.2 g/dL 13.0-17.7"])
    o = named(client, doc, "Hemoglobin")
    assert o["collected_on"] is None and o["reported_on"] == "2024-03-30"
    post(client, f"/api/observations/{o['id']}/verify")
    assert named(client, doc, "Hemoglobin")["collected_on"] is None


def test_no_report_date_leaves_documented_unknown(client):
    doc = imported(client, pdfs.THYROID_MIXED)
    o = named(client, doc, "TSH")
    assert o["reported_on"] is None and o["documented_on"] is None and o["collected_on"] == "2023-09-28"


def test_multiple_results_in_one_pdf_are_separate(client):
    doc = imported(client, pdfs.CMP_RANGE_THEN_UNIT)
    assert len({o["id"] for o in rows(client, doc)}) == 15


def test_accept_publishes_only_that_result(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "HDL Cholesterol")
    assert post(client, f"/api/observations/{o['id']}/verify").json()["verification_status"] == "verified"
    assert [v["reported_name"] for v in verified(client)] == ["HDL Cholesterol"]


def test_no_route_approves_a_list_of_results_without_checking_them(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    ids = [o["id"] for o in rows(client, doc)]
    assert post(client, "/api/observations/verify", {"ids": ids}).status_code in (404, 405, 422)
    assert verified(client) == []


def test_rejected_results_are_not_published_and_can_be_restored(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "Triglycerides")
    post(client, f"/api/observations/{o['id']}/reject")
    assert named(client, doc, "Triglycerides")["verification_status"] == "rejected"
    assert verified(client) == []
    assert post(client, f"/api/observations/{o['id']}/reopen").json()["verification_status"] == "proposed"


def test_correction_keeps_the_original_and_every_step(client):
    doc = imported(client, pdfs.CBC_VALUE_UNIT_RANGE)
    o = named(client, doc, "Hemoglobin")
    url = f"/api/observations/{o['id']}"
    post(client, url + "/correct", {"fields": {"value_text": "14.7"}})
    post(client, url + "/correct", {"fields": {"unit": "g/L", "reference_text": "130-170", "reported_name": "Hgb"}})
    post(client, url + "/verify")
    after = client.get(url).json()
    assert (after["value_text"], after["unit"], after["reported_name"]) == ("14.7", "g/L", "Hgb")
    assert after["normalized_value"] == pytest.approx(1.47) and after["normalized_unit"] == "g/dL"
    assert after["reference_low"] == 130 and after["edited"] is True
    assert after["original"]["value_text"] == "14.20" and after["original"]["unit"] == "g/dL"
    assert [r["action"] for r in after["revisions"]] == ["extracted", "corrected", "corrected", "verified"]
    assert after["revisions"][1]["values"]["value_text"] == "14.7"


def test_editing_an_approved_result_takes_it_back_out_of_the_charts(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "HDL Cholesterol")
    post(client, f"/api/observations/{o['id']}/verify")
    assert post(client, f"/api/observations/{o['id']}/correct", {"fields": {"value_text": "53"}}).json()["verification_status"] == "proposed"
    assert verified(client) == []


def test_a_no_change_correction_changes_nothing(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "HDL Cholesterol")
    post(client, f"/api/observations/{o['id']}/verify")
    after = post(client, f"/api/observations/{o['id']}/correct", {"fields": {"value_text": "52"}}).json()
    assert after["verification_status"] == "verified" and len(after["revisions"]) == 2


def test_collection_date_correction_and_clearing(client):
    doc = imported(client, pdfs.NO_COLLECTION_DATE)
    o = named(client, doc, "Glucose")
    url = f"/api/observations/{o['id']}/correct"
    assert post(client, url, {"fields": {"collected_on": "2020-02-02"}}).json()["collected_on"] == "2020-02-02"
    cleared = post(client, url, {"fields": {"collected_on": None}}).json()
    assert cleared["collected_on"] is None and any("collection date" in i for i in cleared["issues"])


def test_person_edit_flags_date_order_problems(client):
    doc = imported(client, pdfs.CBC_VALUE_UNIT_RANGE)
    o = named(client, doc, "Hemoglobin")
    after = post(client, f"/api/observations/{o['id']}/correct", {"fields": {"collected_on": "2025-01-01"}}).json()
    assert any("report date is before" in i for i in after["issues"])


@pytest.mark.parametrize(
    "fields",
    [{"value_text": ""}, {"reported_name": "  "}, {"collected_on": "yesterday"}, {"collected_on": "2199-01-01"}, {"documented_on": "1800-01-01"}, {"value_text": "1" * 61}, {"unit": "x" * 41}, {"test_code": "ldl"}, {"verification_status": "verified"}, {"value_number": 3}, {"source_text": "x"}, {"unit": 5}],
)
def test_bad_edits_are_refused_and_change_nothing(client, fields):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "HDL Cholesterol")
    assert post(client, f"/api/observations/{o['id']}/correct", {"fields": fields}).status_code == 422
    after = named(client, doc, "HDL Cholesterol")
    assert len(after["revisions"]) == 1 and after["verification_status"] == "proposed"


def test_manual_entry_with_no_document(client):
    fields = {"reported_name": "Vitamin D", "value_text": "32", "unit": "ng/mL", "reference_text": "30-100", "collected_on": "2019-05-05", "lab_name": "A Fictional Lab", "flag": ""}
    response = post(client, "/api/observations", {"fields": fields, "verify": True})
    assert response.status_code == 201
    o = response.json()
    assert o["origin"] == "manual" and o["extraction_status"] == "not_extracted" and o["document_id"] is None
    assert o["verification_status"] == "verified" and o["flag"] is None
    assert o["value_number"] == 32 and o["reference_high"] == 100 and o["lab_name"] == "A Fictional Lab"
    assert [r["action"] for r in o["revisions"]] == ["entered", "verified"]
    assert o["source_page"] is None


def test_manual_entry_on_a_document_when_parsing_failed(client):
    doc = imported(client, ["A fictional letter with results that cannot be recognized by any rule."])
    assert rows(client, doc) == []
    o = post(client, "/api/observations", {"fields": {"reported_name": "Glucose", "value_text": "90", "unit": "mg/dL"}, "document_id": doc}).json()
    assert o["document_id"] == doc and o["verification_status"] == "proposed"
    assert any("collection date" in i for i in o["issues"])
    assert o["collected_on"] is None


def test_manual_entry_keeps_editing_history(client):
    o = post(client, "/api/observations", {"fields": {"reported_name": "Glucose", "value_text": "90"}, "verify": True}).json()
    after = post(client, f"/api/observations/{o['id']}/correct", {"fields": {"value_text": "95", "unit": "mg/dL"}}).json()
    assert after["origin"] == "manual" and after["original"]["value_text"] == "90"
    assert [r["action"] for r in after["revisions"]] == ["entered", "verified", "corrected"]


@pytest.mark.parametrize("body", [{"fields": {"value_text": "1"}}, {"fields": {"reported_name": "Glucose"}}, {"fields": {"reported_name": "G", "value_text": "1"}, "document_id": "a" * 32}, {"fields": {"reported_name": "G", "value_text": "1"}, "document_id": "../x"}, {"not": "right"}])
def test_bad_manual_entries_are_refused(client, body):
    assert post(client, "/api/observations", body).status_code == 422
    assert rows(client) == []


def test_requests_need_the_app_header(client):
    assert client.post("/api/observations", json={"fields": {"reported_name": "G", "value_text": "1"}}).status_code == 403
    doc = imported(client, pdfs.LIPID_BOUNDS)
    o = named(client, doc, "HDL Cholesterol")
    for action in ("verify", "reject", "reopen", "correct"):
        assert client.post(f"/api/observations/{o['id']}/{action}", json={}).status_code == 403
    assert client.post("/api/observations/approve-group", json={}).status_code == 403


def test_unknown_ids_are_404(client):
    assert client.get("/api/observations/" + "a" * 32).status_code == 404
    assert post(client, "/api/observations/" + "a" * 32 + "/verify").status_code == 404
    assert client.get("/api/observations/not-an-id").status_code == 422


def test_same_result_in_two_documents_is_flagged_not_merged(client):
    a = imported(client, pdfs.LIPID_BOUNDS, "a.pdf")
    b = imported(client, [*pdfs.LIPID_BOUNDS, "An extra fictional line."], "b.pdf")
    first, second = named(client, a, "HDL Cholesterol"), named(client, b, "HDL Cholesterol")
    assert first["possible_duplicates"] == [second["id"]] and second["possible_duplicates"] == [first["id"]]
    post(client, f"/api/observations/{second['id']}/reject")
    assert named(client, a, "HDL Cholesterol")["possible_duplicates"] == []


def test_same_test_same_date_different_value_is_not_a_duplicate(client):
    a = post(client, "/api/observations", {"fields": {"reported_name": "Glucose", "value_text": "90", "unit": "mg/dL", "collected_on": "2020-01-01"}}).json()
    post(client, "/api/observations", {"fields": {"reported_name": "Glucose", "value_text": "91", "unit": "mg/dL", "collected_on": "2020-01-01"}})
    assert client.get(f"/api/observations/{a['id']}").json()["possible_duplicates"] == []


def test_same_value_in_a_different_unit_spelling_is_a_duplicate(client):
    a = post(client, "/api/observations", {"fields": {"reported_name": "WBC", "value_text": "6.2", "unit": "K/uL", "collected_on": "2020-01-01"}}).json()
    post(client, "/api/observations", {"fields": {"reported_name": "White Blood Cells", "value_text": "6.2", "unit": "x10E3/uL", "collected_on": "2020-01-01"}})
    assert len(client.get(f"/api/observations/{a['id']}").json()["possible_duplicates"]) == 1


def test_uploading_the_same_file_again_adds_no_results(client):
    imported(client, pdfs.LIPID_BOUNDS, "a.pdf")
    imported(client, pdfs.LIPID_BOUNDS, "copy.pdf")
    assert len(rows(client)) == 4


def test_rereading_does_not_undo_a_rejection_or_correction(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    tg, hdl = named(client, doc, "Triglycerides"), named(client, doc, "HDL Cholesterol")
    post(client, f"/api/observations/{tg['id']}/reject")
    post(client, f"/api/observations/{hdl['id']}/correct", {"fields": {"value_text": "60"}})
    post(client, f"/api/documents/{doc}/extract")
    client.app.state.extraction.wait_idle()
    assert len(rows(client, doc)) == 4
    assert named(client, doc, "Triglycerides")["verification_status"] == "rejected"
    assert next(o for o in rows(client, doc) if o["id"] == hdl["id"])["value_text"] == "60"


def test_everything_survives_a_restart(data_dir):
    first = client_for(data_dir)
    doc = imported(first, pdfs.CBC_VALUE_UNIT_RANGE)
    hgb, plt, wbc = named(first, doc, "Hemoglobin"), named(first, doc, "Platelets"), named(first, doc, "WBC")
    post(first, f"/api/observations/{hgb['id']}/correct", {"fields": {"value_text": "14.9"}})
    post(first, f"/api/observations/{hgb['id']}/verify")
    post(first, f"/api/observations/{plt['id']}/reject")
    post(first, "/api/observations", {"fields": {"reported_name": "Glucose", "value_text": "90", "unit": "mg/dL", "collected_on": "2019-01-01"}, "verify": True})
    expected = first.get("/api/observations").json()
    assert wbc["verification_status"] == "proposed"
    first.app.state.engine.dispose()

    second = client_for(data_dir)
    second.app.state.extraction.wait_idle()
    assert second.get("/api/observations").json() == expected


def test_a_saved_review_resumes_where_it_stopped(data_dir):
    first = client_for(data_dir)
    doc = imported(first, pdfs.LIPID_BOUNDS)
    done = named(first, doc, "HDL Cholesterol")
    post(first, f"/api/observations/{done['id']}/verify")
    first.app.state.engine.dispose()
    second = client_for(data_dir)
    statuses = sorted(o["verification_status"] for o in rows(second, doc))
    assert statuses == ["proposed", "proposed", "proposed", "verified"]


def test_document_review_cannot_finish_with_undecided_results(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    detail = client.get(f"/api/documents/{doc}").json()
    for field, entry in detail["metadata"].items():
        post(client, f"/api/documents/{doc}/metadata/{field}", {"action": "not_stated"})
    response = post(client, f"/api/documents/{doc}/review", {"complete": True})
    assert response.status_code == 409 and response.json()["code"] == "undecided_observations"
    for o in rows(client, doc):
        post(client, f"/api/observations/{o['id']}/reject")
    assert post(client, f"/api/documents/{doc}/review", {"complete": True}).json()["review_status"] == "completed"


def test_results_never_touch_the_original_file(client, data_dir):
    body = pdfs.text_pdf(pdfs.LIPID_BOUNDS)
    upload(client, body)
    client.app.state.extraction.wait_idle()
    stored = next(p for p in (data_dir / "originals").rglob("*") if p.is_file())
    for o in rows(client):
        post(client, f"/api/observations/{o['id']}/correct", {"fields": {"value_text": "1"}})
    assert stored.read_bytes() == body


def test_older_readings_are_read_again_once_after_an_upgrade(data_dir):
    first = client_for(data_dir)
    doc = imported(first, pdfs.LIPID_BOUNDS)
    post(first, f"/api/documents/{doc}/metadata/provider", {"action": "corrected", "value": "Kept Fictional Lab"})
    with first.app.state.engine.begin() as connection:
        connection.execute(text("UPDATE extraction_runs SET method = 'rules-v1'"))
        connection.execute(text("DELETE FROM lab_observation_revisions"))
        connection.execute(text("DELETE FROM lab_observations"))
    first.app.state.engine.dispose()
    second = client_for(data_dir)
    second.app.state.extraction.wait_idle()
    detail = second.get(f"/api/documents/{doc}").json()
    assert [r["method"] for r in detail["runs"]] == ["rules-v1", METHOD]
    assert detail["metadata"]["provider"]["value"] == "Kept Fictional Lab"
    assert len(rows(second, doc)) == 4
    second.app.state.engine.dispose()
    third = client_for(data_dir)
    third.app.state.extraction.wait_idle()
    assert len(third.get(f"/api/documents/{doc}").json()["runs"]) == 2


def test_logs_hold_no_results_or_names(client, caplog):
    caplog.set_level(logging.DEBUG)
    doc = imported(client, pdfs.CBC_VALUE_UNIT_RANGE)
    o = named(client, doc, "Hemoglobin")
    post(client, f"/api/observations/{o['id']}/correct", {"fields": {"value_text": "99.9", "reported_name": "SECRETNAME"}})
    post(client, "/api/observations", {"fields": {"reported_name": "SECRETMANUAL", "value_text": "77.7"}})
    assert any("corrected" in r.getMessage() for r in caplog.records)
    for secret in ("Hemoglobin", "14.20", "99.9", "SECRETNAME", "SECRETMANUAL", "77.7", "Testperson"):
        assert secret not in caplog.text


def test_catalog_endpoint(client):
    tests = client.get("/api/lab-tests").json()
    assert {"code": "ldl", "name": "LDL cholesterol", "short": "LDL", "unit": "mg/dL"} in tests


def _shown(client, doc):
    return [{"id": o["id"], "version": o["version"]} for o in rows(client, doc) if o["verification_status"] == "proposed"]


def test_accept_all_accepts_exactly_what_was_shown_each_with_its_own_history(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    response = post(client, "/api/observations/accept-many", {"items": _shown(client, doc)})
    assert response.status_code == 200, response.text
    assert [o["verification_status"] for o in rows(client, doc)] == ["verified"] * 4
    assert all([r["action"] for r in o["revisions"]] == ["extracted", "verified"] for o in rows(client, doc))
    one = rows(client, doc)[0]
    post(client, f"/api/observations/{one['id']}/reopen")  # Each can still be undone alone.
    assert sorted(o["verification_status"] for o in rows(client, doc)) == ["proposed", "verified", "verified", "verified"]


@pytest.mark.parametrize("change", ["corrected", "rejected"])
def test_accept_all_accepts_nothing_if_any_row_changed_after_it_was_shown(client, change):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    shown = _shown(client, doc)
    target = shown[0]["id"]
    if change == "corrected":
        post(client, f"/api/observations/{target}/correct", {"fields": {"value_text": "61"}})
    else:
        post(client, f"/api/observations/{target}/reject")
    response = post(client, "/api/observations/accept-many", {"items": shown})
    assert response.status_code == 409 and response.json()["code"] == "group_changed"
    assert not verified(client)


def test_accept_all_refuses_a_row_with_no_value(client):
    doc = imported(client, pdfs.LIPID_BOUNDS)
    blank = rows(client, doc)[0]
    with client.app.state.engine.begin() as connection:
        connection.execute(text("UPDATE lab_observations SET value_text = '' WHERE id = :i"), {"i": blank["id"]})
    response = post(client, "/api/observations/accept-many", {"items": _shown(client, doc)})
    assert response.status_code == 422
    assert not verified(client)
