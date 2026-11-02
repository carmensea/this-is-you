from __future__ import annotations

from datetime import date

import pytest

from this_is_you.extraction.lab_rows import MAX_ROWS, parse_lab_rows
from this_is_you.extraction.runner import Limits, extract
from this_is_you.lab_catalog import BY_CODE, canonical_unit, find_test, normalize, parse_range, parse_value

from . import pdfs

TODAY = date(2026, 11, 1)


def rows(lines, today=TODAY):
    return parse_lab_rows([(1, "\n".join(lines))], today)


def by_name(lines):
    return {r.name: r for r in rows(lines)}


def test_cbc_value_unit_range_layout():
    found = by_name(pdfs.CBC_VALUE_UNIT_RANGE)
    assert len(found) == 7
    hgb = found["Hemoglobin"]
    assert (hgb.value, hgb.unit, hgb.reference, hgb.flag) == ("14.20", "g/dL", "13.0-17.7", None)  # Printed value kept: 14.20, not 14.2.
    assert hgb.collected == "2024-03-28" and hgb.reported == "2024-03-30"
    assert hgb.confidence == "high" and hgb.issues == []
    assert found["WBC"].unit == "x10E3/uL"
    assert found["Platelets"].flag == "H"


def test_cmp_range_then_unit_layout():
    found = by_name(pdfs.CMP_RANGE_THEN_UNIT)
    assert len(found) == 15
    assert (found["Glucose"].value, found["Glucose"].flag, found["Glucose"].reference, found["Glucose"].unit) == ("101", "H", "65-99", "mg/dL")
    assert found["AST (SGOT)"].unit == "IU/L"
    assert found["eGFR"].reference == ">59"
    assert found["Bilirubin, Total"].value == "0.6"


def test_lipid_one_sided_ranges_and_month_name_dates():
    found = by_name(pdfs.LIPID_BOUNDS)
    assert found["Total Cholesterol"].reference == "<200"
    assert found["HDL Cholesterol"].reference == ">39"
    assert found["LDL Cholesterol"].flag == "H"
    assert found["LDL Cholesterol"].collected == "2022-01-05" and found["LDL Cholesterol"].reported == "2022-01-06"


def test_thyroid_panel():
    found = by_name(pdfs.THYROID_MIXED)
    assert (found["TSH"].value, found["TSH"].unit) == ("2.310", "uIU/mL")
    assert found["T4, Free"].unit == "ng/dL"
    assert found["TSH"].reported is None  # None printed, none invented.


def test_flag_is_only_what_was_printed():
    assert by_name(["Collected: 2021-01-05", "Glucose 500 mg/dL 65-99"])["Glucose"].flag is None


@pytest.mark.parametrize("text,flag,value", [("Glucose 101 H 65-99 mg/dL", "H", "101"), ("Glucose 101H 65-99 mg/dL", "H", "101"), ("Glucose (H) 101 65-99 mg/dL", "H", "101"), ("Glucose 50 Low 65-99 mg/dL", "Low", "50"), ("Glucose 101 [H] mg/dL 65-99", "H", "101"), ("Glucose 101 mg/dL 65 - 99", None, "101"), ("Glucose: 101 mg/dL 65 to 99", None, "101")])
def test_flag_and_range_spellings(text, flag, value):
    row = rows([text])[0]
    assert (row.flag, row.value) == (flag, value)
    assert row.reference in ("65-99",)


def test_missing_collection_date_stays_unknown_and_says_so():
    for row in rows(pdfs.NO_COLLECTION_DATE):
        assert row.collected is None
        assert any("No collection date" in i for i in row.issues)
        assert row.confidence == "low"


def test_a_birth_or_report_date_is_never_used_as_collection_date():
    row = rows(["DOB: 02/14/1971", "Reported: 2024-03-30", "Printed: 2024-04-01", "Glucose 90 mg/dL 65-99"])[0]
    assert row.collected is None and row.reported == "2024-03-30"


def test_date_after_the_results_applies_when_there_is_only_one():
    row = rows(["Glucose 90 mg/dL 65-99", "Collected: 2021-01-05"])[0]
    assert row.collected == "2021-01-05" and not any("No collection date" in i for i in row.issues)


def test_several_collection_dates_follow_their_own_sections():
    first, second = rows(pdfs.TWO_COLLECTIONS)
    assert (first.collected, first.value) == ("2021-01-05", "14.2")
    assert (second.collected, second.value) == ("2022-02-06", "13.9")


def test_rows_before_the_first_of_several_dates_stay_unknown():
    row = rows(["Glucose 90 mg/dL 65-99", "Collected: 2021-01-05", "Sodium 140 mmol/L 134-144", "Collected: 2022-02-06"])[0]
    assert row.collected is None


def test_ambiguous_collection_date_is_flagged():
    row = rows(pdfs.AMBIGUOUS_ROWS)[0]
    assert row.collected == "2020-03-11"
    assert any("2020-11-03" in i for i in row.issues) and row.confidence == "low"


def test_service_date_is_used_only_with_a_warning():
    row = rows(["Date of Service: 2021-01-05", "Glucose 90 mg/dL 65-99"])[0]
    assert row.collected == "2021-01-05"
    assert any("date of service" in i for i in row.issues) and row.confidence == "low"


def test_collection_and_report_on_one_line():
    row = rows(["Collected: 2021-01-05 Reported: 2021-01-07", "Glucose 90 mg/dL 65-99"])[0]
    assert (row.collected, row.reported) == ("2021-01-05", "2021-01-07")


def test_missing_unit_is_not_assumed():
    found = by_name(pdfs.MISSING_UNIT)
    assert found["Glucose"].unit is None and found["Hemoglobin"].unit is None
    assert any("None was assumed" in i for i in found["Glucose"].issues)
    assert found["Glucose"].confidence == "low"


def test_ambiguous_rows_are_proposed_with_their_doubts():
    found = by_name(pdfs.AMBIGUOUS_ROWS)
    assert found["TSH"].value == "<0.01" and any("limit" in i for i in found["TSH"].issues)
    assert found["Hemoglobin"].value == "14,2" and any("comma" in i for i in found["Hemoglobin"].issues)
    assert found["Glucose"].value == "91" and any("(88)" in i for i in found["Glucose"].issues)
    assert any("unusual" in i for i in found["Sodium"].issues)
    assert all(r.confidence == "low" for r in found.values())


def test_lines_that_are_not_results_are_ignored():
    assert rows(pdfs.NOT_RESULTS) == []


def test_unknown_test_needs_full_shape_and_is_flagged():
    row = rows(pdfs.UNKNOWN_TEST)[0]
    assert row.name == "Fictional Marker Alpha" and row.confidence == "low"
    assert any("not in the known list" in i for i in row.issues)
    assert rows(["Fictional Marker Alpha 12"]) == []


def test_a1c_is_not_hemoglobin():
    found = by_name(["Hemoglobin A1c 5.4 % 4.8-5.6", "Hemoglobin 14.2 g/dL 13.0-17.7"])
    assert found["Hemoglobin A1c"].value == "5.4" and found["Hemoglobin"].value == "14.2"
    assert find_test("Hemoglobin A1c").code == "a1c" and find_test("Hemoglobin").code == "hgb"


def test_future_dates_are_not_accepted_as_collection():
    assert rows(["Collected: 2199-01-01", "Glucose 90 mg/dL 65-99"])[0].collected is None


def test_row_count_is_capped():
    assert len(rows(["Collected: 2021-01-05"] + [f"Glucose {i} mg/dL 65-99" for i in range(MAX_ROWS + 50)])) == MAX_ROWS


def test_multi_page_reports_keep_page_and_line():
    found = parse_lab_rows([(1, "Collected: 2021-01-05\nGlucose 90 mg/dL 65-99"), (2, "Header\nSodium 140 mmol/L 134-144")], TODAY)
    assert [(r.name, r.page, r.line) for r in found] == [("Glucose", 1, 2), ("Sodium", 2, 2)]
    assert found[1].collected == "2021-01-05"
    assert found[1].source == "Sodium 140 mmol/L 134-144"


@pytest.mark.parametrize("name", ["CBC_VALUE_UNIT_RANGE", "CMP_RANGE_THEN_UNIT", "LIPID_BOUNDS", "THYROID_MIXED"])
def test_real_pdfs_go_through_the_limited_process(tmp_path, name):
    lines = getattr(pdfs, name)
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.text_pdf(lines))
    result = extract(path, Limits(), TODAY)
    assert result.status == "extracted"
    assert {r["name"] for r in result.lab_rows} == {r.name for r in rows(lines)}


def test_separately_drawn_table_cells_are_read(tmp_path):
    table = [[(40, "Hemoglobin"), (200, "14.2"), (260, "g/dL"), (340, "13.0-17.7")], [(40, "Glucose"), (200, "101"), (240, "H"), (260, "mg/dL"), (340, "65-99")]]
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.columns_pdf(table, ["Laboratory Report", "Collected: 2021-01-05"]))
    found = {r["name"]: r for r in extract(path, Limits(), TODAY).lab_rows}
    assert found["Hemoglobin"]["value"] == "14.2" and found["Hemoglobin"]["reference"] == "13.0-17.7"
    assert found["Glucose"]["flag"] == "H" and found["Glucose"]["collected"] == "2021-01-05"


def test_unreadable_formats_yield_no_rows_and_no_error(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(pdfs.text_pdf(["A fictional letter with no results at all, written for testing."]))
    result = extract(path, Limits(), TODAY)
    assert result.status == "extracted" and result.lab_rows == []


# ---- Units and conversions

@pytest.mark.parametrize("spelled,canonical", [("mg/dl", "mg/dL"), ("MG/DL", "mg/dL"), ("K/uL", "×10³/µL"), ("x10E3/uL", "×10³/µL"), ("10^3/uL", "×10³/µL"), ("uIU/mL", "mIU/L"), ("mcg/dL", "µg/dL"), ("furlongs", "furlongs"), (None, None)])
def test_unit_spellings(spelled, canonical):
    assert canonical_unit(spelled) == canonical


@pytest.mark.parametrize(
    "name,number,unit,expected",
    [("Glucose", 5.0, "mmol/L", (90.08, "mg/dL")), ("Hemoglobin", 142.0, "g/L", (14.2, "g/dL")), ("Creatinine", 88.4, "µmol/L", (1.0, "mg/dL")), ("Total Cholesterol", 5.0, "mmol/L", (193.35, "mg/dL")), ("Triglycerides", 1.0, "mmol/L", (88.57, "mg/dL")), ("Sodium", 140.0, "mEq/L", (140.0, "mmol/L")), ("TSH", 2.3, "uIU/mL", (2.3, "mIU/L")), ("WBC", 6.2, "K/uL", (6.2, "×10³/µL"))],
)
def test_safe_conversions(name, number, unit, expected):
    assert normalize(find_test(name), number, unit)[1] == expected[1]
    assert normalize(find_test(name), number, unit)[0] == pytest.approx(expected[0], abs=0.01)


@pytest.mark.parametrize("name,number,unit", [("Glucose", 90.0, None), ("Glucose", None, "mg/dL"), ("Glucose", 90.0, "g/dL"), ("Hemoglobin", 14.0, "mmol/L"), ("Unknown Test", 1.0, "mg/dL")])
def test_conversions_that_are_not_safe_are_not_made(name, number, unit):
    assert normalize(find_test(name), number, unit) == (None, None)


def test_every_catalog_entry_expects_its_own_unit():
    for test in BY_CODE.values():
        assert test.unit in test.expected_units
        assert canonical_unit(test.unit) == test.unit


@pytest.mark.parametrize("text,bounds", [("13.5-17.5", (13.5, 17.5)), ("13.5 - 17.5", (13.5, 17.5)), ("65 to 99", (65, 99)), ("<200", (None, 200)), ("<= 5", (None, 5)), (">39", (39, None)), ("≥ 40", (40, None)), ("Negative", (None, None)), ("99-65", (None, None)), (None, (None, None))])
def test_reference_range_bounds(text, bounds):
    assert parse_range(text) == bounds


@pytest.mark.parametrize("text,number", [("14.2", 14.2), ("14.20", 14.2), ("1,234", 1234.0), ("<0.5", None), (">60", None), ("14,2", None), ("Negative", None), ("1.2.3", None)])
def test_value_parsing(text, number):
    assert parse_value(text) == number
