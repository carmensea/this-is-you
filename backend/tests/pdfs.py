"""Builds synthetic medical PDFs. Every name and value here is invented."""
from __future__ import annotations

import io
import zlib

from pypdf import PdfReader, PdfWriter


def _escape(text: str) -> bytes:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("latin-1", "replace")


def text_pdf(*pages: list[str], title: str | None = None) -> bytes:
    """A real PDF with one list of lines per page."""
    objects: list[bytes] = []
    add = lambda body: (objects.append(body), len(objects))[1]  # noqa: E731
    catalog = add(b"")
    tree = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for lines in pages:
        ops = b"BT /F1 11 Tf 14 TL 72 740 Td " + b" ".join(b"(" + _escape(line) + b") Tj T*" for line in lines) + b" ET"
        content = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(ops), ops))
        kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (tree, content, font)))
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % tree
    objects[tree - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    info = add(b"<< /Title (" + _escape(title) + b") >>") if title else None
    return _assemble(objects, catalog, info)


def _assemble(objects: list[bytes], root: int, info: int | None = None) -> bytes:
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    extra = b" /Info %d 0 R" % info if info else b""
    out += b"trailer\n<< /Size %d /Root %d 0 R%s >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, root, extra, xref)
    return out


def image_only_pdf(pages: int = 1) -> bytes:
    """Looks like a scan: every page is a picture, with no text."""
    objects: list[bytes] = [b"", b""]
    image_data = zlib.compress(bytes(300))
    image = 3
    objects.append(b"<< /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream" % (len(image_data), image_data))
    kids = []
    for _ in range(pages):
        ops = b"q 500 0 0 700 50 50 cm /Im0 Do Q"
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(ops), ops))
        content = len(objects)
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R /Resources << /XObject << /Im0 %d 0 R >> >> >>" % (content, image))
        kids.append(len(objects))
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    return _assemble(objects, 1)


def mixed_pdf(text_lines: list[str]) -> bytes:
    """One page of text followed by a scanned page."""
    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(text_pdf(text_lines))).pages:
        writer.add_page(page)
    for page in PdfReader(io.BytesIO(image_only_pdf())).pages:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def encrypted_pdf(lines: list[str], password: str = "secret") -> bytes:
    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(text_pdf(lines))).pages:
        writer.add_page(page)
    writer.encrypt(password, algorithm="RC4-128")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def decompression_bomb_pdf(megabytes: int = 300) -> bytes:
    """A small file whose content stream inflates to hundreds of megabytes."""
    compressor = zlib.compressobj(9)
    data = b"".join(compressor.compress(b"\0" * (1024 * 1024)) for _ in range(megabytes)) + compressor.flush()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        b"<< /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream" % (len(data), data),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R >>",
    ]
    return _assemble(objects, 1)


LAB_REPORT = [
    "Northwood Diagnostics Laboratory",
    "LABORATORY REPORT",
    "Patient: Avery Testperson",
    "DOB: 02/14/1971",
    "Specimen Collected: March 12, 2024",
    "Reported: March 14, 2024",
    "Ordering Physician: Dr. Fictional Example",
    "Complete Blood Count",
    "Test Result Reference Range",
    "Hemoglobin 14.2 13.5-17.5 g/dL",
]
RADIOLOGY_REPORT = ["Harborview Imaging Center", "RADIOLOGY REPORT", "Patient: Avery Testperson", "Exam Date: 2023-07-09", "Radiologist: Dr. Sample Reader", "MRI lumbar spine", "Technique: routine sequences", "Impression: fictional findings"]
PATHOLOGY_REPORT = ["Surgical Pathology Report", "Facility: Lakeside Pathology Associates", "Date of Service: 5 January 2022", "Gross Description: fictional specimen", "Microscopic Description: fictional findings", "Pathologist: Dr. Imagined Name"]
OPERATIVE_REPORT = ["Operative Report", "Hospital: Saint Nowhere Medical Center", "Date of Surgery: 18-Apr-2024", "Preoperative Diagnosis: fictional", "Postoperative Diagnosis: fictional", "Anesthesia: general"]
VISIT_NOTE = ["Cedar Lane Family Practice", "Progress Note", "Date of Visit: 09/28/2023", "Chief Complaint: fictional complaint", "History of Present Illness: invented text for testing", "Assessment and Plan: none"]
AMBIGUOUS_DATE = ["Riverside Clinic", "Visit Note", "Date of Service: 03/11/2020", "Chief Complaint: fictional complaint for testing only"]
CONFLICTING_DATES = ["Visit Note", "Date of Service: 2021-01-05", "Some fictional text in the middle of this page.", "Date of Service: 2021-02-06"]
ONLY_BIRTH_DATE = ["Letter from a fictional office about nothing in particular", "DOB: 1971-02-14", "This page has plenty of text but says little."]
UNCLEAR = ["Dear Avery,", "Here is a fictional letter that mentions nothing a rule can recognize.", "Kind regards"]
FUTURE_DATE = ["Visit Note", "Date of Service: 2199-01-01", "Fictional text long enough to count as readable."]
