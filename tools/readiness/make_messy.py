"""Builds a large, messy folder of fictional records, and says what the app should report about each file.

Every name and value is invented. Usage: make_messy.py OUTPUT_FOLDER EXPECTED_JSON [--scale N]
Run with the backend's Python: it borrows the PDF builders the backend tests use.
"""
from __future__ import annotations

import io
import json
import random
import sys
from pathlib import Path

from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from tests import pdfs  # noqa: E402

ME = "Avery Testperson"
EARLIER = "Avery Oldname"
BORN_US, BORN_ISO = "02/14/1971", "1971-02-14"
ORIGIN = "Records of Avery"


def lab(rng: random.Random, patient: str | None, birth: str | None, n: int, panel: int = 0) -> bytes:
    day = f"{rng.randint(1, 12):02d}/{rng.randint(1, 28):02d}/{rng.randint(2009, 2025)}"
    lines = ["Northwood Diagnostics Laboratory", "LABORATORY REPORT"]
    if patient:
        lines.append(f"Patient: {patient}")
    if birth:
        lines.append(f"DOB: {birth}")
    lines += [f"Collected: {day}", "Test Result Units Reference Range"]
    lines += [f"Hemoglobin {rng.uniform(12, 17):.1f} g/dL 13.0-17.7", f"Glucose {rng.randint(70, 130)} mg/dL 65-99", f"Sodium {rng.randint(132, 146)} mmol/L 134-144", f"Reference {n}.{panel} of this fictional series, with some text."]
    return pdfs.text_pdf(lines)


def varied(body: bytes, n: int) -> bytes:
    """The same pages with different bytes, as separate scans of a form would be."""
    writer = PdfWriter(clone_from=io.BytesIO(body))
    writer.add_metadata({"/Subject": f"Fictional scan {n}"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build(out: Path, expected_path: Path, scale: int) -> None:
    rng = random.Random(20261102)
    expected = {"read": 0, "partial": 0, "duplicate": 0, "scanned": 0, "encrypted": 0, "no_text": 0, "unsupported": 0, "failed": 0}
    stored, mismatches, undetermined = 0, 0, 0
    files: dict[str, bytes] = {}
    root = out / ORIGIN

    def add(path: str, body: bytes, category: str, keeps: bool | None = None) -> None:
        nonlocal stored
        files[path] = body
        expected[category] += 1
        stored += category in ("read", "partial", "scanned", "encrypted", "no_text") if keeps is None else keeps

    mine: list[str] = []
    for n in range(240 * scale):
        path = f"{2009 + n % 17}/labs/{'nested/' * (n % 4)}Lab report {n}.pdf"
        name = [ME, ME.upper(), "Testperson, Avery Q", "A. Testperson", EARLIER][n % 5]
        add(path, lab(rng, name, BORN_US if n % 3 else "1971-02-14", n), "read")
        mine.append(path)
    for n in range(50 * scale):
        add(f"from a clinic/someone else/other {n}.pdf", lab(rng, "Morgan Otherperson", "03/15/1980", n, 1), "read")
        mismatches += 1
    for n in range(15 * scale):
        add(f"from a clinic/mixed up/right name wrong birth {n}.pdf", lab(rng, ME, "09/09/1999", n, 2), "read")
        mismatches += 1
    for n in range(40 * scale):
        add(f"letters/no patient label {n}.pdf", lab(rng, None, None, n, 3), "read")
        undetermined += 1
    for n in range(40 * scale):
        add(f"scans/{2010 + n % 5}/scan {n}.pdf", varied(pdfs.image_only_pdf(1 + n % 3), n), "scanned")
        undetermined += 1
    for n in range(20 * scale):
        add(f"mixed/part scanned {n}.pdf", pdfs.mixed_pdf([f"Patient: {ME}", f"DOB: {BORN_US}", f"Fictional mixed document number {n}, long enough to count as text."]), "partial")
    for n in range(15 * scale):
        add(f"locked/password protected {n}.pdf", pdfs.encrypted_pdf(["Fictional locked document", f"Number {n}"], f"secret{n}"), "encrypted")
        undetermined += 1
    for n in range(10 * scale):
        add(f"odd/nothing printed {n}.pdf", pdfs.text_pdf(["x"], title=f"Number {n}"), "no_text")
        undetermined += 1
    for n in range(30 * scale):  # The same bytes under another name, in another folder.
        add(f"exports/copy of everything/{n} copy.pdf", files[mine[n]], "duplicate")
    for n in range(10 * scale):  # Damaged or fake, though named like a PDF.
        add(f"damaged/cut off {n}.pdf", lab(rng, ME, BORN_US, n, 4)[:150], "failed")
        add(f"damaged/really a photo {n}.pdf", b"\xff\xd8\xff fictional image bytes %d" % n, "failed")
    for n in range(5 * scale):  # Looks like a PDF from outside, so it is stored, and then cannot be read.
        add(f"damaged/unreadable inside {n}.pdf", b"%%PDF-1.4\nfictional nonsense %d\n%%%%EOF\n" % n, "failed", keeps=True)
        undetermined += 1
    add("damaged/empty.pdf", b"", "failed")
    add("damaged/UPPER CASE EMPTY.PDF", b"", "failed")
    for n in range(10 * scale):
        add(f"photos/page {n}.jpg", b"\xff\xd8\xff fictional %d" % n, "unsupported")
        add(f"exports/results {n}.csv", b"test,value\nfictional,%d\n" % n, "unsupported")
        add(f"letters/letter {n}.docx", b"PK fictional %d" % n, "unsupported")
    add(".DS_Store", b"fictional system file", "unsupported")
    add("big/too large.pdf", b"%PDF-1.4\n" + bytes(6 * 1024 * 1024) + b"\n%%EOF\n", "unsupported")
    # Names that have broken importers elsewhere.
    add("odd names/ünï çødé 日本語 résumé.pdf", lab(rng, ME, BORN_US, 1, 5), "read")
    add("odd names/100% done #1 & more.pdf", lab(rng, ME, BORN_US, 2, 5), "read")
    add("odd names/" + "very long name " * 14 + ".pdf", lab(rng, ME, BORN_US, 3, 5), "read")
    add("/".join(f"level{n}" for n in range(30)) + "/deep.pdf", lab(rng, ME, BORN_US, 4, 5), "read")
    add("odd names/UPPER CASE.PDF", lab(rng, ME, BORN_US, 5, 5), "read")

    for path, body in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    expected_path.write_text(json.dumps({
        "origin": ORIGIN, "total": len(files), "counts": {k: v for k, v in expected.items() if v}, "stored": stored, "mismatches": mismatches, "undetermined": undetermined,
        "identity": {"full_name": ME, "date_of_birth": BORN_ISO, "previous_names": [EARLIER]}, "forbidden_in_logs": [ME, "Testperson", "Otherperson", "Oldname", ORIGIN, "Lab report"],
    }, indent=1))


if __name__ == "__main__":
    scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 1
    build(Path(sys.argv[1]), Path(sys.argv[2]), scale)
