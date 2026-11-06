"""Urine microscopy tables: per-field units, results printed as ranges, and graded words such as "Few".

Every name, value and date here is invented. Each layout is one way such a table can reach the parser.
"""
from __future__ import annotations

from datetime import date

from this_is_you.extraction.lab_rows import parse_lab_rows
from this_is_you.extraction.runner import Limits, extract

from . import pdfs

TODAY = date(2026, 11, 1)
HEAD = ["Fictional Family Health Portal", "Urinalysis with Microscopic Examination", "Specimen Collected: 03/04/2025", "Microscopic Examination"]
NAMES = ["WBC, Urine", "RBC, Urine", "Squamous Epithelial Cells", "Bacteria", "Hyaline Casts"]

CELLS_PER_LINE = HEAD + ["Component", "Your Value", "Standard Range",
    "WBC, Urine", "0-2 /HPF", "0 - 5 /HPF",
    "RBC, Urine", "3-5 /HPF", "0 - 2 /HPF",
    "Squamous Epithelial Cells", "Few",
    "Bacteria", "None seen", "None seen",
    "Hyaline Casts", "0-2 /LPF", "0 - 2 /LPF"]

ROW_PER_LINE = HEAD + ["Component Your Value Standard Range",
    "WBC, Urine 0-2 /HPF 0 - 5 /HPF",
    "RBC, Urine 3-5 /HPF 0 - 2 /HPF",
    "Squamous Epithelial Cells Few",
    "Bacteria None seen None seen",
    "Hyaline Casts 0-2 /LPF 0 - 2 /LPF"]

SINGLE_NUMBERS = HEAD + ["Component", "Your Value", "Standard Range",
    "WBC, Urine", "1", "0 - 5 /HPF",
    "RBC, Urine", "2", "0 - 2 /HPF",
    "Squamous Epithelial Cells", "Few",
    "Bacteria", "Moderate", "None seen",
    "Hyaline Casts", "0", "0 - 2 /LPF"]


def rows(lines):
    return parse_lab_rows([(1, "\n".join(lines))], TODAY)


def table(lines):
    return [(r.name, r.value, r.unit, r.reference) for r in rows(lines)]


RANGED = [
    ("WBC, Urine", "0-2", "/HPF", "0-5"),
    ("RBC, Urine", "3-5", "/HPF", "0-2"),
    ("Squamous Epithelial Cells", "Few", None, None),
    ("Bacteria", "None seen", None, "None seen"),
    ("Hyaline Casts", "0-2", "/LPF", "0-2"),
]


def test_one_cell_per_line_keeps_all_five_results_in_order():
    assert table(CELLS_PER_LINE) == RANGED


def test_one_row_per_line_keeps_all_five_results_in_order():
    assert table(ROW_PER_LINE) == RANGED


def test_a_graded_word_is_a_result_and_never_a_test_name():
    assert table(SINGLE_NUMBERS) == [
        ("WBC, Urine", "1", "/HPF", "0-5"),
        ("RBC, Urine", "2", "/HPF", "0-2"),
        ("Squamous Epithelial Cells", "Few", None, None),
        ("Bacteria", "Moderate", None, "None seen"),
        ("Hyaline Casts", "0", "/LPF", "0-2"),
    ]


def test_other_graded_words_are_results():
    found = table(HEAD + ["Component", "Your Value", "Standard Range", "Mucus", "Rare", "Calcium Oxalate Crystals", "Occasional",
                          "Renal Epithelial Cells", "Many", "Yeast", "Not seen", "Granular Casts", "1+"])
    assert [(n, v) for n, v, _, _ in found] == [("Mucus", "Rare"), ("Calcium Oxalate Crystals", "Occasional"), ("Renal Epithelial Cells", "Many"), ("Yeast", "Not seen"), ("Granular Casts", "1+")]


def test_a_range_printed_as_the_result_is_kept_as_words_with_its_doubt():
    wbc = rows(CELLS_PER_LINE)[0]
    assert any("range rather than one number" in i for i in wbc.issues) and wbc.confidence == "low"


def test_a_labelled_range_is_never_taken_for_the_value():
    found = rows(HEAD + ["Component Your Value Standard Range", "WBC, Urine", "Standard Range", "0 - 5 /HPF", "Your Value", "0-2 /HPF"])
    assert [(r.value, r.reference) for r in found] == [("0-2", "0-5")]


def test_a_single_range_with_no_second_one_stays_a_reference_with_no_value():
    # With one range and nothing else, there is no telling which column it was. It is not guessed to be the result.
    found = rows(HEAD + ["Component", "Your Value", "Standard Range", "Hyaline Casts", "0 - 2 /LPF", "Bacteria", "Few"])
    assert [(r.name, r.value, r.reference) for r in found] == [("Hyaline Casts", "", "0-2"), ("Bacteria", "Few", None)]
    assert any("No value could be read" in i for i in found[0].issues)


def test_a_value_that_cannot_be_read_keeps_its_measurement_and_its_text():
    found = rows(HEAD + ["Component", "Your Value", "Standard Range", "WBC, Urine", "0-2/HPF0-5/HPF", "Bacteria", "Few"])
    wbc = found[0]
    assert (wbc.name, wbc.value) == ("WBC, Urine", "")
    assert "0-2/HPF0-5/HPF" in wbc.source and wbc.confidence == "low"
    assert any("could not be read" in i and "0-2/HPF0-5/HPF" in i for i in wbc.issues)
    assert found[1].name == "Bacteria"


def test_headings_and_notes_are_not_measurements():
    lines = HEAD + ["Component", "Your Value", "Standard Range", "Microscopic Examination", "Bacteria", "Few",
                    "Urine Sediment", "Results reviewed by fictional staff.", "Performed at Fictional Lab", "Few cells were seen in the sample."]
    assert [r.name for r in rows(lines)] == ["Bacteria"]


def test_every_result_keeps_its_source_text_and_line():
    for r in rows(CELLS_PER_LINE):
        assert r.source.startswith(r.name) and r.page == 1 and r.line > 0
    assert rows(CELLS_PER_LINE)[0].source == "WBC, Urine | 0-2 /HPF | 0 - 5 /HPF"


def test_a_microscopy_table_in_a_real_pdf(tmp_path):
    path = tmp_path / "report.pdf"
    path.write_bytes(pdfs.text_pdf(CELLS_PER_LINE))
    found = [(r["name"], r["value"], r["unit"], r["reference"]) for r in extract(path, Limits(), TODAY).lab_rows]
    assert found == RANGED
