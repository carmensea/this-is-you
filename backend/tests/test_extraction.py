from __future__ import annotations

import socket
import sys
import textwrap
import time
from datetime import date
from pathlib import Path

import pytest

from this_is_you.extraction.rules import propose_all
from this_is_you.extraction.runner import ExtractionResult, Limits, extract, parse_output, run_command

from . import pdfs

TODAY = date(2026, 11, 1)


def read(tmp_path: Path, body: bytes, limits: Limits = Limits()) -> ExtractionResult:
    path = tmp_path / "input.pdf"
    path.write_bytes(body)
    return extract(path, limits, TODAY)


def proposals(result: ExtractionResult) -> dict[str, dict]:
    return {p["field"]: p for p in result.proposals}


@pytest.mark.parametrize(
    "lines,kind,day,provider,title",
    [
        (pdfs.LAB_REPORT, "lab", "2024-03-12", "Northwood Diagnostics Laboratory", "LABORATORY REPORT"),
        (pdfs.RADIOLOGY_REPORT, "imaging", "2023-07-09", "Harborview Imaging Center", "RADIOLOGY REPORT"),
        (pdfs.PATHOLOGY_REPORT, "pathology", "2022-01-05", "Lakeside Pathology Associates", "Surgical Pathology Report"),
        (pdfs.OPERATIVE_REPORT, "procedure", "2024-04-18", "Saint Nowhere Medical Center", "Operative Report"),
        (pdfs.VISIT_NOTE, "note", "2023-09-28", "Cedar Lane Family Practice", "Progress Note"),
    ],
)
def test_proposes_all_details_from_a_real_pdf(tmp_path, lines, kind, day, provider, title):
    result = read(tmp_path, pdfs.text_pdf(lines))
    assert result.status == "extracted"
    assert result.page_count == 1 and result.pages_with_text == 1
    found = proposals(result)
    assert found["document_type"]["value"] == kind
    assert found["service_date"]["value"] == day
    assert found["provider"]["value"] == provider
    assert found["report_title"]["value"] == title
    for proposal in found.values():
        assert proposal["confidence"] in ("high", "medium", "low")
        assert proposal["reason"] and proposal["page"] == 1


def test_evidence_shows_the_source_line_and_page(tmp_path):
    result = read(tmp_path, pdfs.text_pdf(["Cover page with enough fictional words to count as text."], ["Date of Service: 2022-05-04", "Fictional text."]))
    date_proposal = proposals(result)["service_date"]
    assert date_proposal["page"] == 2
    assert "2022-05-04" in date_proposal["snippet"]


def test_birth_date_and_report_date_are_never_the_service_date():
    found = {p.field: p for p in propose_all([(1, "\n".join(pdfs.LAB_REPORT))], None, TODAY)}
    assert found["service_date"].value == "2024-03-12"
    assert not any(p.field == "service_date" for p in propose_all([(1, "\n".join(pdfs.ONLY_BIRTH_DATE))], None, TODAY))
    assert not any(p.field == "service_date" for p in propose_all([(1, "Reported: 2024-03-14\nSome fictional words here.")], None, TODAY))


def test_ambiguous_numeric_date_is_low_confidence_and_says_why():
    found = {p.field: p for p in propose_all([(1, "\n".join(pdfs.AMBIGUOUS_DATE))], None, TODAY)}["service_date"]
    assert found.value == "2020-03-11"
    assert found.confidence == "low"
    assert "2020-11-03" in found.reason


def test_unambiguous_numeric_date_is_not_flagged():
    found = {p.field: p for p in propose_all([(1, "Date of Service: 03/28/2020")], None, TODAY)}["service_date"]
    assert found.confidence == "high" and found.value == "2020-03-28"


def test_day_first_date_is_understood_when_only_one_reading_works():
    assert {p.field: p for p in propose_all([(1, "Date of Service: 28/03/2020")], None, TODAY)}["service_date"].value == "2020-03-28"


def test_conflicting_dates_are_low_confidence():
    found = {p.field: p for p in propose_all([(1, "\n".join(pdfs.CONFLICTING_DATES))], None, TODAY)}["service_date"]
    assert found.confidence == "low"
    assert "2 different dates" in found.reason


def test_impossible_and_future_dates_are_not_proposed():
    for text in ["\n".join(pdfs.FUTURE_DATE), "Date of Service: 13/45/2020", "Date of Service: 1850-01-01"]:
        assert not any(p.field == "service_date" for p in propose_all([(1, text)], None, TODAY))


def test_unlabeled_date_is_only_a_low_confidence_guess():
    found = {p.field: p for p in propose_all([(1, "A fictional letter\nJune 3, 2019\nNothing else of note.")], None, TODAY)}["service_date"]
    assert found.confidence == "low" and "no label" in found.reason


def test_nothing_recognizable_gives_no_proposals_rather_than_guesses():
    assert propose_all([(1, "\n".join(pdfs.UNCLEAR))], None, TODAY) == []


def test_mixed_signals_lower_the_type_confidence():
    text = "Some fictional page\nspecimen and biopsy and impression are all mentioned here"
    found = {p.field: p for p in propose_all([(1, text)], None, TODAY)}["document_type"]
    assert found.confidence == "low"


def test_patient_lines_are_not_taken_as_provider():
    assert not any(p.field == "provider" and "Testperson" in p.value for p in propose_all([(1, "Patient: Avery Testperson\nDOB: 1971-02-14\nFictional text.")], None, TODAY))


def test_a_person_label_is_flagged_as_a_person():
    found = {p.field: p for p in propose_all([(1, "Some fictional words on the page\nOrdering Physician: Dr. Fictional Example")], None, TODAY)}["provider"]
    assert found.value == "Dr. Fictional Example" and found.confidence == "medium" and "person" in found.reason


def test_embedded_file_title_is_low_confidence(tmp_path):
    found = proposals(read(tmp_path, pdfs.text_pdf(pdfs.UNCLEAR, title="Fictional Embedded Heading")))
    assert found["report_title"]["confidence"] == "low"
    assert found["report_title"]["value"] == "Fictional Embedded Heading"


def test_image_only_pdf_is_detected(tmp_path):
    result = read(tmp_path, pdfs.image_only_pdf(pages=3))
    assert result.status == "image_only"
    assert result.page_count == 3 and result.pages_with_text == 0
    assert result.proposals == []


def test_encrypted_pdf_is_detected_and_not_opened(tmp_path):
    result = read(tmp_path, pdfs.encrypted_pdf(pdfs.LAB_REPORT))
    assert result.status == "encrypted"
    assert result.proposals == []


def test_mixed_pdf_is_partial_and_still_proposes(tmp_path):
    result = read(tmp_path, pdfs.mixed_pdf(pdfs.LAB_REPORT))
    assert result.status == "partial"
    assert result.page_count == 2 and result.pages_with_text == 1
    assert proposals(result)["document_type"]["value"] == "lab"


def test_blank_pdf_is_no_text(tmp_path):
    assert read(tmp_path, pdfs.text_pdf(["  "])).status == "no_text"


def test_page_limit_is_reported_as_partial(tmp_path):
    many = [["Fictional page with enough words to count as readable text."] for _ in range(6)]
    result = read(tmp_path, pdfs.text_pdf(*many), Limits(max_pages=2))
    assert result.status == "partial" and result.truncated
    assert result.page_count == 6 and result.pages_read == 2


def test_text_limit_is_reported_as_partial(tmp_path):
    result = read(tmp_path, pdfs.text_pdf(["Fictional line with enough words to count as text." for _ in range(40)]), Limits(max_chars=100))
    assert result.status == "partial" and result.truncated


@pytest.mark.parametrize(
    "body",
    [b"%PDF-1.4\nthis is not really a pdf\n%%EOF\n", b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", b"%PDF-1.4\n" + bytes(range(256)) * 50 + b"\n%%EOF"],
)
def test_malformed_files_fail_cleanly(tmp_path, body):
    result = read(tmp_path, body)
    assert result.status in ("failed", "no_text")
    assert result.proposals == []


def test_decompression_bomb_is_contained(tmp_path):
    started = time.monotonic()
    result = read(tmp_path, pdfs.decompression_bomb_pdf(300), Limits(wall_seconds=30, memory_bytes=256 * 1024 * 1024))
    assert result.status in ("too_complex", "failed", "no_text", "partial")
    assert result.proposals == []
    assert time.monotonic() - started < 35


def _script(tmp_path: Path, body: str) -> list[str]:
    script = tmp_path / "script.py"
    script.write_text(textwrap.dedent(body))
    return [sys.executable, str(script)]


def test_a_hung_reader_is_killed_at_the_time_limit(tmp_path):
    started = time.monotonic()
    assert run_command(_script(tmp_path, "import time\nwhile True: time.sleep(1)"), 0.5).status == "too_complex"
    assert time.monotonic() - started < 5


def test_a_cpu_hog_is_stopped_by_the_cpu_limit(tmp_path):
    command = _script(tmp_path, """
        from this_is_you.extraction.worker import apply_limits
        apply_limits({"cpu_seconds": 1, "memory_bytes": 2 * 1024 ** 3})
        while True: pass
    """)
    started = time.monotonic()
    assert run_command(command, 20).status == "too_complex"
    assert time.monotonic() - started < 10


def test_a_memory_hog_is_stopped_by_the_memory_limit(tmp_path):
    command = _script(tmp_path, """
        from this_is_you.extraction.worker import apply_limits
        apply_limits({"cpu_seconds": 20, "memory_bytes": 200 * 1024 ** 2})
        blocks = []
        while True:
            blocks.append(bytearray(b"x" * (10 * 1024 ** 2)))
    """)
    assert run_command(command, 20).status == "too_complex"


def test_the_reader_cannot_write_files(tmp_path):
    target = tmp_path / "written.txt"
    command = _script(tmp_path, f"""
        import signal
        from this_is_you.extraction.worker import apply_limits
        signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
        apply_limits({{"cpu_seconds": 5, "memory_bytes": 2 * 1024 ** 3}})
        try:
            open({str(target)!r}, "w").write("data")
        except OSError:
            print('{{"status":"failed"}}')
    """)
    run_command(command, 10)
    assert not target.exists() or target.read_text() == ""


def test_the_reader_cannot_use_the_network():
    from this_is_you.extraction import worker

    saved = socket.socket, socket.create_connection, socket.getaddrinfo
    try:
        worker.forbid_network()
        with pytest.raises(OSError, match="disabled"):
            socket.socket()
        with pytest.raises(OSError, match="disabled"):
            socket.create_connection(("127.0.0.1", 80))
    finally:
        socket.socket, socket.create_connection, socket.getaddrinfo = saved


def test_a_crashing_reader_is_a_failure_and_its_error_text_goes_nowhere(tmp_path, capfd, caplog):
    assert run_command(_script(tmp_path, "import sys\nsys.stderr.write('SECRET PATIENT TEXT')\nraise SystemExit(3)"), 5).status == "failed"
    captured = capfd.readouterr()
    assert "SECRET" not in captured.out + captured.err + caplog.text


def test_reader_output_is_treated_as_untrusted():
    assert parse_output(b"not json").status == "failed"
    assert parse_output(b'{"status": "verified"}').status == "failed"
    assert parse_output(b"[]").status == "failed"
    result = parse_output(b'{"status":"extracted","text_sha256":"short","proposals":[{"field":"verified","value":"x","confidence":"high","page":1},{"field":"provider","value":"ok","confidence":"certain","page":1},{"field":"provider","value":"ok","confidence":"high","page":1}]}')
    assert result.text_sha256 is None
    assert [p["confidence"] for p in result.proposals] == ["high"]
