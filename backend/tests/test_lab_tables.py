"""Result tables with headings like "Your Value" and "Standard Range", as PDF text really comes out of them.

Every name, value and date here is invented. Each fixture reproduces how a table of this general shape can reach the
parser: whole rows, one cell per line, a label beside each cell, and across pages.
"""
from __future__ import annotations

from datetime import date

import pytest

from this_is_you.extraction.lab_rows import parse_lab_rows
from this_is_you.extraction.runner import Limits, extract
from this_is_you.lab_catalog import canonical_unit, find_test, normalize

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, upload

TODAY = date(2026, 11, 1)
HEAD = ["Fictional Family Health Portal", "CBC with Differential", "Patient: Avery Testperson", "Collected on Mar 5, 2024 9:12 AM", "Result Date: Mar 6, 2024"]
TABLE_HEAD = ["Component Results", "Component Your Value Standard Range Flag"]


def rows(lines, today=TODAY):
    return parse_lab_rows([(1, "\n".join(lines))], today)


def by_name(lines):
    return {r.name: r for r in rows(lines)}


# ---- The shapes

WHOLE_ROWS = HEAD + TABLE_HEAD + [
    "WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL",
    "RBC 4.61 x10E6/uL 3.77 - 5.28 x10E6/uL",
    "Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL",
    "Hematocrit 41.2 % 34.0 - 46.6 %",
    "MCV 89 fL 79 - 97 fL",
    "Platelets 451 x10E3/uL 150 - 450 x10E3/uL High",
    "Neutrophils 58 % Not Estab. %",
    "Neutrophils (Absolute) 3.6 x10E3/uL 1.4 - 7.0 x10E3/uL",
    "Lymphocytes (Absolute) 0.7 x10E3/uL 0.7 - 3.1 x10E3/uL Low",
]

ONE_CELL_PER_LINE = HEAD + ["Component Results", "Component", "Your Value", "Standard Range", "Flag",
    "WBC", "6.2 x10E3/uL", "3.4 - 10.8 x10E3/uL",
    "Hemoglobin", "13.9 g/dL", "11.1 - 15.9 g/dL",
    "Platelets", "451 x10E3/uL", "150 - 450 x10E3/uL", "High",
    "Absolute Neutrophils", "3.6", "x10E3/uL", "1.4 - 7.0", "x10E3/uL",
    "MCV", "89", "fL", "79-97", "L",
]

LABELLED_CELLS = HEAD + ["Component Results",
    "WBC", "Your Value", "6.2 x10E3/uL", "Standard Range", "3.4 - 10.8 x10E3/uL",
    "Hemoglobin", "Your Value: 13.9 g/dL", "Standard Range: 11.1 - 15.9 g/dL", "Flag: Low",
    "Platelets", "Normal range: 150 - 450 x10E3/uL", "Value 451 x10E3/uL",
]

LABELLED_ON_ONE_LINE = HEAD + [
    "WBC Your Value 6.2 x10E3/uL Standard Range 3.4 - 10.8 x10E3/uL",
    "Hemoglobin Your Value 13.9 g/dL Standard Range 11.1 - 15.9 g/dL Flag Low",
]

FULL_CBC = HEAD + TABLE_HEAD + [
    "WBC 6.2 10*3/uL 3.4 - 10.8 10*3/uL", "RBC 4.61 10*6/uL 3.77 - 5.28 10*6/uL", "Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL", "Hematocrit 41.2 % 34.0 - 46.6 %",
    "MCV 89 fL 79 - 97 fL", "MCH 30.2 pg 26.6 - 33.0 pg", "MCHC 33.7 g/dL 31.5 - 35.7 g/dL", "RDW-CV 13.1 % 11.7 - 15.4 %", "RDW-SD 42.0 fL 35.0 - 46.0 fL", "Platelet Count 310 10*3/uL 150 - 450 10*3/uL", "MPV 10.1 fL 7.4 - 10.4 fL",
    "Neutrophils % 58.1 % 40 - 70 %", "Lymphocytes % 31.2 % 20 - 45 %", "Monocytes % 7.3 % 2 - 10 %", "Eosinophils % 2.4 % 0 - 5 %", "Basophils % 0.6 % 0 - 2 %", "Immature Granulocytes % 0.4 % 0 - 1 %",
    "Absolute Neutrophils 3.60 10*3/uL 1.40 - 7.00 10*3/uL", "Absolute Lymphocytes 1.93 10*3/uL 0.70 - 3.10 10*3/uL", "Absolute Monocytes 0.45 10*3/uL 0.10 - 0.90 10*3/uL", "Absolute Eosinophils 0.15 10*3/uL 0.00 - 0.40 10*3/uL", "Absolute Basophils 0.04 10*3/uL 0.00 - 0.20 10*3/uL", "nRBC 0 /100 WBC 0 - 0 /100 WBC",
]


def test_whole_rows_under_the_headings():
    found = by_name(WHOLE_ROWS)
    assert len(found) == 9
    wbc = found["WBC"]
    assert (wbc.value, wbc.unit, wbc.reference, wbc.flag) == ("6.2", "x10E3/uL", "3.4-10.8", None)
    assert wbc.confidence == "high" and wbc.issues == []
    assert found["Platelets"].flag == "High"
    assert found["Lymphocytes (Absolute)"].flag == "Low"


def test_one_cell_per_line_is_gathered_into_rows():
    found = by_name(ONE_CELL_PER_LINE)
    assert set(found) == {"WBC", "Hemoglobin", "Platelets", "Absolute Neutrophils", "MCV"}
    assert (found["WBC"].value, found["WBC"].unit, found["WBC"].reference, found["WBC"].flag) == ("6.2", "x10E3/uL", "3.4-10.8", None)
    assert found["Platelets"].flag == "High"
    assert (found["Absolute Neutrophils"].value, found["Absolute Neutrophils"].unit, found["Absolute Neutrophils"].reference) == ("3.6", "x10E3/uL", "1.4-7.0")
    assert (found["MCV"].value, found["MCV"].unit, found["MCV"].reference, found["MCV"].flag) == ("89", "fL", "79-97", "L")
    assert all(r.confidence == "high" and r.issues == [] for r in found.values())


def test_a_label_beside_each_cell():
    found = by_name(LABELLED_CELLS)
    assert (found["WBC"].value, found["WBC"].reference) == ("6.2", "3.4-10.8")
    assert (found["Hemoglobin"].value, found["Hemoglobin"].unit, found["Hemoglobin"].reference, found["Hemoglobin"].flag) == ("13.9", "g/dL", "11.1-15.9", "Low")
    assert (found["Platelets"].value, found["Platelets"].reference) == ("451", "150-450")


def test_labels_inline_on_one_line():
    found = by_name(LABELLED_ON_ONE_LINE)
    assert (found["WBC"].value, found["WBC"].unit, found["WBC"].reference) == ("6.2", "x10E3/uL", "3.4-10.8")
    assert found["Hemoglobin"].flag == "Low"


def test_a_full_cbc_with_differential_needs_no_manual_entry():
    found = rows(FULL_CBC)
    assert len(found) == 23
    assert [r for r in found if r.confidence != "high" or r.issues] == []
    codes = {r.name: find_test(r.name, r.unit).code for r in found}
    assert codes["Neutrophils %"] == "neut_pct" and codes["Absolute Neutrophils"] == "neut_abs"
    assert codes["RDW-SD"] == "rdwsd" and codes["RDW-CV"] == "rdw" and codes["Platelet Count"] == "plt"


# ---- Exactness

def test_measurements_and_units_stay_exactly_as_printed():
    found = by_name(HEAD + TABLE_HEAD + ["Hemoglobin 13.90 g/dL 11.10 - 15.90 g/dL", "WBC 6.2 10*3/uL 3.4 - 10.8 10*3/uL", "MCV", "89.0", "fL", "Platelets 1,204 x10E3/uL 150 - 450"])
    assert found["Hemoglobin"].value == "13.90" and found["WBC"].unit == "10*3/uL"
    assert found["MCV"].value == "89.0" and found["Platelets"].value == "1,204"


@pytest.mark.parametrize("spelled,canonical", [
    ("10*3/uL", "×10³/µL"), ("x10E3/uL", "×10³/µL"), ("K/mcL", "×10³/µL"), ("thou/uL", "×10³/µL"), ("10^3/μL", "×10³/µL"), ("x10(3)/mcL", "×10³/µL"),
    ("10*6/uL", "×10⁶/µL"), ("M/mcL", "×10⁶/µL"), ("million/uL", "×10⁶/µL"), ("10^9/L", "×10⁹/L"), ("10^12/L", "×10¹²/L"), ("cells/uL", "cells/µL"),
])
def test_blood_count_unit_spellings(spelled, canonical):
    assert canonical_unit(spelled) == canonical
    found = by_name(HEAD + TABLE_HEAD + [f"WBC 6.2 {spelled} 3.4 - 10.8"])
    assert found["WBC"].unit == spelled  # Stored as printed, whatever it means.


def test_conversions_for_counts_are_exact():
    assert normalize(find_test("WBC"), 6.2, "10^9/L") == (6.2, "×10³/µL")
    assert normalize(find_test("Absolute Neutrophils"), 3600.0, "cells/uL") == (3.6, "×10³/µL")


def test_a_percentage_and_a_count_are_different_tests():
    assert find_test("Neutrophils", "%").code == "neut_pct"
    assert find_test("Neutrophils", "x10E3/uL").code == "neut_abs"
    assert find_test("Neutrophils") is None
    assert normalize(find_test("Neutrophils %"), 58.0, "x10E3/uL") == (None, None)


def test_a_flag_is_only_what_was_printed():
    found = by_name(HEAD + TABLE_HEAD + ["Platelets 900 x10E3/uL 150 - 450 x10E3/uL", "WBC", "99", "x10E3/uL", "3.4 - 10.8"])
    assert found["Platelets"].flag is None and found["WBC"].flag is None


# ---- Nothing guessed, and doubts shown

def test_a_missing_unit_is_not_assumed_and_is_shown():
    found = by_name(HEAD + TABLE_HEAD + ["WBC", "6.2", "3.4 - 10.8"])
    assert found["WBC"].unit is None and found["WBC"].confidence == "low"
    assert any("No unit" in i for i in found["WBC"].issues)


def test_a_missing_range_is_not_assumed():
    found = by_name(HEAD + TABLE_HEAD + ["Hemoglobin", "13.9 g/dL"])
    assert found["Hemoglobin"].reference is None and found["Hemoglobin"].confidence == "medium"


def test_a_missing_date_is_not_assumed():
    found = by_name(TABLE_HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8"])
    assert found["WBC"].collected is None and any("No collection date" in i for i in found["WBC"].issues)


def test_a_report_date_is_not_used_as_the_collection_date():
    found = by_name(["Result Date: Mar 6, 2024"] + TABLE_HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8"])
    assert found["WBC"].collected is None and found["WBC"].reported == "2024-03-06"


def test_a_row_with_no_value_is_shown_for_a_person_to_finish():
    found = by_name(HEAD + TABLE_HEAD + ["Hemoglobin", "Standard Range: 11.1 - 15.9 g/dL", "WBC", "6.2 x10E3/uL", "3.4 - 10.8"])
    assert found["Hemoglobin"].value == "" and found["Hemoglobin"].reference == "11.1-15.9" and found["Hemoglobin"].confidence == "low"
    assert "No value could be read" in found["Hemoglobin"].issues[0]
    assert found["WBC"].value == "6.2"


def test_an_unfamiliar_test_in_a_table_is_shown_with_a_doubt():
    found = by_name(HEAD + TABLE_HEAD + ["Fictional Marker Alpha 12", "Fictional Marker Beta", "7.5"])
    assert found["Fictional Marker Alpha"].value == "12" and found["Fictional Marker Alpha"].confidence == "low"
    assert found["Fictional Marker Beta"].value == "7.5"
    assert all(any("not in the known list" in i for i in r.issues) for r in found.values())


def test_a_bare_differential_name_with_no_unit_says_why_it_is_unsure():
    found = by_name(HEAD + TABLE_HEAD + ["Neutrophils", "58"])
    assert found["Neutrophils"].confidence == "low" and any("percentage or a count" in i for i in found["Neutrophils"].issues)


def test_a_word_result_is_kept_as_words_and_not_graphed():
    found = by_name(HEAD + TABLE_HEAD + ["Fictional Screen", "Your Value", "Negative", "Standard Range", "Negative"])
    row = found["Fictional Screen"]
    assert (row.value, row.reference) == ("Negative", "Negative")
    assert any("word rather than a number" in i for i in row.issues)


def test_a_range_in_words_is_kept_as_printed():
    found = by_name(HEAD + TABLE_HEAD + ["Basophils", "1 %", "Not Estab."])
    assert found["Basophils"].reference == "Not Estab."


def test_two_units_for_one_result_are_questioned():
    found = by_name(HEAD + TABLE_HEAD + ["WBC", "6.2 x10E3/uL", "3.4 - 10.8 g/dL"])
    assert found["WBC"].unit == "x10E3/uL" and any("Two different units" in i for i in found["WBC"].issues)


def test_a_second_number_is_questioned_not_chosen():
    found = by_name(HEAD + TABLE_HEAD + ["WBC", "6.2 x10E3/uL", "3.4 - 10.8", "7.9"])
    assert found["WBC"].value == "6.2" and any("Another number" in i for i in found["WBC"].issues)


def test_cells_with_no_name_above_them_are_not_attached_to_anything():
    assert rows(HEAD + TABLE_HEAD + ["6.2 x10E3/uL", "3.4 - 10.8 x10E3/uL", "High"]) == []


def test_headings_and_prose_around_a_table_are_not_results():
    lines = HEAD + TABLE_HEAD + [
        "CBC with Differential", "WBC 6.2 x10E3/uL 3.4 - 10.8", "Comment: fictional comment about 3 samples.", "Please contact your provider with 2 questions.",
        "Ordering provider: Fictional Name", "Performing lab: Fictional Lab, 100 Sample Road", "Mar 6, 2024 8:15 AM", "Result Notes", "Page 1 of 2", "This test was developed by a fictional lab.",
    ]
    assert [r.name for r in rows(lines)] == ["WBC"]


def test_cells_are_never_paired_by_counting():
    # A whole column of names and then a whole column of values. Pairing them by position would be a guess.
    assert [r.value for r in rows(HEAD + TABLE_HEAD + ["WBC", "RBC", "Hemoglobin"]) if r.value] == []


# ---- Pages and provenance

def test_a_table_continues_across_pages_with_a_repeated_heading():
    page1 = "\n".join(HEAD + TABLE_HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8", "Page 1 of 2"])
    page2 = "\n".join(["Avery Testperson", "Page 2 of 2"] + TABLE_HEAD + ["Hemoglobin", "13.9 g/dL", "11.1 - 15.9 g/dL", "MCV 89 fL 79 - 97"])
    found = {r.name: r for r in parse_lab_rows([(1, page1), (2, page2)], TODAY)}
    assert (found["WBC"].page, found["Hemoglobin"].page, found["MCV"].page) == (1, 2, 2)
    assert all(r.collected == "2024-03-05" and r.reported == "2024-03-06" for r in found.values())
    assert all(r.confidence == "high" for r in found.values())


def test_a_row_split_by_a_page_break_is_read_and_questioned():
    page1 = "\n".join(HEAD + TABLE_HEAD + ["Hemoglobin", "Page 1 of 2"])
    page2 = "\n".join(["Page 2 of 2", "13.9 g/dL", "11.1 - 15.9 g/dL"])
    row = parse_lab_rows([(1, page1), (2, page2)], TODAY)[0]
    assert (row.value, row.page) == ("13.9", 1) and row.confidence == "low"
    assert any("page break" in i for i in row.issues)


def test_each_row_says_where_it_came_from():
    page = "\n".join(HEAD + TABLE_HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8", "Hemoglobin", "13.9 g/dL", "11.1 - 15.9 g/dL"])
    found = {r.name: r for r in parse_lab_rows([(3, page)], TODAY)}
    assert (found["WBC"].page, found["WBC"].line, found["WBC"].source) == (3, 8, "WBC 6.2 x10E3/uL 3.4 - 10.8")
    assert (found["Hemoglobin"].page, found["Hemoglobin"].line) == (3, 9)
    assert found["Hemoglobin"].source == "Hemoglobin | 13.9 g/dL | 11.1 - 15.9 g/dL"


# ---- Real PDFs, through the isolated reader

@pytest.mark.parametrize("name", ["WHOLE_ROWS", "ONE_CELL_PER_LINE", "LABELLED_CELLS", "LABELLED_ON_ONE_LINE", "FULL_CBC"])
def test_each_shape_as_a_real_pdf(tmp_path, name):
    lines = globals()[name]
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.text_pdf(lines))
    result = extract(path, Limits(), TODAY)
    assert result.status == "extracted"
    assert {r["name"] for r in result.lab_rows} == {r.name for r in rows(lines)}
    assert all(r["collected"] == "2024-03-05" for r in result.lab_rows)


def test_a_table_drawn_cell_by_cell_is_read_by_its_position(tmp_path):
    table = [[(40, "Component"), (200, "Your Value"), (340, "Standard Range"), (480, "Flag")]]
    table += [[(40, "WBC"), (200, "6.2 x10E3/uL"), (340, "3.4 - 10.8 x10E3/uL")], [(40, "Platelets"), (200, "451 x10E3/uL"), (340, "150 - 450 x10E3/uL"), (480, "High")], [(40, "Absolute Neutrophils"), (200, "3.60 x10E3/uL"), (340, "1.40 - 7.00 x10E3/uL")]]
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.columns_pdf(table, ["CBC with Differential", "Collected on Mar 5, 2024 9:12 AM"]))
    found = {r["name"]: r for r in extract(path, Limits(), TODAY).lab_rows}
    assert (found["WBC"]["value"], found["WBC"]["unit"], found["WBC"]["reference"]) == ("6.2", "x10E3/uL", "3.4-10.8")
    assert found["Platelets"]["flag"] == "High" and found["Absolute Neutrophils"]["value"] == "3.60"


def test_a_table_on_two_pages_as_a_real_pdf(tmp_path):
    first = HEAD + TABLE_HEAD + ["WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL", "Hemoglobin 13.9 g/dL 11.1 - 15.9 g/dL"]
    second = ["Page 2 of 2"] + TABLE_HEAD + ["MCV 89 fL 79 - 97 fL", "Platelets 310 x10E3/uL 150 - 450 x10E3/uL"]
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.text_pdf(first, second))
    found = {r["name"]: r for r in extract(path, Limits(), TODAY).lab_rows}
    assert (found["WBC"]["page"], found["MCV"]["page"]) == (1, 2) and len(found) == 4


# ---- The whole way through the app

def _read(client, lines):
    answer = upload(client, pdfs.text_pdf(lines), "fictional cbc.pdf")
    client.app.state.extraction.wait_idle()
    return answer.json()["document"]["id"]


def test_an_imported_cbc_proposes_its_results_for_review(client):
    document = _read(client, FULL_CBC)
    observations = [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == document]
    assert len(observations) == 23
    assert all(o["verification_status"] == "proposed" for o in observations)
    wbc = next(o for o in observations if o["reported_name"] == "WBC")
    assert (wbc["value_text"], wbc["unit"], wbc["test_code"], wbc["source_page"]) == ("6.2", "10*3/uL", "wbc", 1)
    assert wbc["normalized_value"] == 6.2


def test_a_row_with_no_value_cannot_be_approved_until_it_has_one(client):
    _read(client, HEAD + TABLE_HEAD + ["Hemoglobin", "Standard Range: 11.1 - 15.9 g/dL", "WBC", "6.2 x10E3/uL", "3.4 - 10.8"])
    observations = {o["reported_name"]: o for o in client.get("/api/observations").json()["observations"]}
    hgb = observations["Hemoglobin"]
    assert hgb["value_text"] == "" and hgb["verification_status"] == "proposed"
    assert client.post("/api/observations/verify", json={"ids": [hgb["id"]]}, headers=CLIENT_HEADERS).status_code == 422
    assert client.post(f"/api/observations/{hgb['id']}/correct", json={"fields": {"value_text": "13.9", "unit": "g/dL"}}, headers=CLIENT_HEADERS).status_code == 200
    assert client.post("/api/observations/verify", json={"ids": [hgb["id"]]}, headers=CLIENT_HEADERS).status_code == 200


def test_reading_again_with_new_line_numbers_does_not_double_results(data_dir, tmp_path):
    from this_is_you import observations as service
    from this_is_you.models import Document

    client = client_for(data_dir)
    document = _read(client, FULL_CBC)
    before = len(client.get("/api/observations").json()["observations"])
    sessions = client.app.state.sessions
    with sessions() as session:
        rows_again = [{"name": "WBC", "value": "6.2", "unit": "10*3/uL", "reference": "3.4-10.8", "flag": None, "collected": "2024-03-05", "reported": "2024-03-06", "page": 1, "line": 99, "source": "WBC 6.2", "confidence": "high", "issues": []}]
        service.add_extracted_rows(session, session.get(Document, document), None, rows_again)
        session.commit()
    assert len(client.get("/api/observations").json()["observations"]) == before


@pytest.mark.parametrize("heading", ["Component Results", "Results", "Test Results"])
def test_a_table_heading_is_not_proposed_as_the_report_title(tmp_path, heading):
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.text_pdf(["Fictional Family Health Portal", "CBC with Differential Panel", heading, "Collected on Mar 5, 2024", "WBC 6.2 x10E3/uL 3.4 - 10.8 x10E3/uL"]))
    titles = [p["value"] for p in extract(path, Limits(), TODAY).proposals if p["field"] == "report_title"]
    assert titles == ["CBC with Differential Panel"]
