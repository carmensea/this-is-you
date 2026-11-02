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


# ---- Laboratory report layouts. Every name and value is invented.
def columns_pdf(rows: list[list[tuple[int, str]]], header: list[str] | None = None) -> bytes:
    """Text placed at x positions, as real table PDFs do: each cell is drawn separately."""
    objects: list[bytes] = [b"", b""]
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    ops = b"BT /F1 10 Tf ET "
    y = 760
    for line in header or []:
        ops += b"BT /F1 10 Tf 40 %d Td (%s) Tj ET " % (y, _escape(line))
        y -= 16
    for row in rows:
        for x, text in row:
            ops += b"BT /F1 10 Tf %d %d Td (%s) Tj ET " % (x, y, _escape(text))
        y -= 16
    objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(ops), ops))
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 3 0 R >> >> >>")
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [5 0 R] /Count 1 >>"
    return _assemble(objects, 1)


CBC_VALUE_UNIT_RANGE = [
    "Northwood Diagnostics Laboratory", "LABORATORY REPORT", "Patient: Avery Testperson", "DOB: 02/14/1971", "Collected: 03/28/2024", "Reported: 03/30/2024",
    "Test Result Units Reference Range",
    "WBC 6.2 x10E3/uL 3.4-10.8", "RBC 4.81 x10E6/uL 4.14-5.80", "Hemoglobin 14.20 g/dL 13.0-17.7", "Hematocrit 43.1 % 37.5-51.0",
    "MCV 89 fL 79-97", "MCH 29.5 pg 26.6-33.0", "Platelets 410 H x10E3/uL 150-400",
]
CMP_RANGE_THEN_UNIT = [
    "Harbor Clinical Labs", "Comprehensive Metabolic Panel", "Date Collected: 2023-07-09", "Report Date: 2023-07-11",
    "Glucose 101 H 65-99 mg/dL", "BUN 15 6-24 mg/dL", "Creatinine 1.02 0.76-1.27 mg/dL", "eGFR 92 >59 mL/min/1.73m2",
    "Sodium 140 134-144 mmol/L", "Potassium 4.4 3.5-5.2 mmol/L", "Chloride 102 96-106 mmol/L", "Carbon Dioxide 24 18-29 mmol/L",
    "Calcium 9.5 8.6-10.2 mg/dL", "Total Protein 7.1 6.0-8.5 g/dL", "Albumin 4.5 3.5-5.5 g/dL", "Bilirubin, Total 0.6 0.0-1.2 mg/dL",
    "Alkaline Phosphatase 70 39-117 IU/L", "AST (SGOT) 24 0-40 IU/L", "ALT (SGPT) 29 0-44 IU/L",
]
LIPID_BOUNDS = [
    "Lakeside Medical Laboratory", "Lipid Panel", "Specimen Collected: January 5, 2022", "Resulted: January 6, 2022",
    "Total Cholesterol 198 mg/dL <200", "Triglycerides 142 mg/dL <150", "HDL Cholesterol 52 mg/dL >39", "LDL Cholesterol 118 H mg/dL <100",
]
THYROID_MIXED = ["Cedar Reference Lab", "Thyroid Function", "Collection Date: 09/28/2023", "TSH 2.310 uIU/mL 0.450-4.500", "T4, Free 1.21 ng/dL 0.82-1.77", "Free T3 3.1 pg/mL 2.0-4.4"]
NO_COLLECTION_DATE = ["Fictional Lab", "Laboratory Report", "Hemoglobin 14.2 g/dL 13.0-17.7", "Glucose 90 mg/dL 65-99"]
TWO_COLLECTIONS = ["Fictional Lab", "Laboratory Report", "Collected: 2021-01-05", "Hemoglobin 14.2 g/dL 13.0-17.7", "Collected: 2022-02-06", "Hemoglobin 13.9 g/dL 13.0-17.7"]
MISSING_UNIT = ["Laboratory Report", "Collected: 2021-01-05", "Glucose 90 65-99", "Hemoglobin 14.2"]
AMBIGUOUS_ROWS = ["Laboratory Report", "Collected: 03/11/2020", "TSH <0.01 mIU/L 0.45-4.50", "Hemoglobin 14,2 g/dL 13.0-17.7", "Glucose 91 88 mg/dL 65-99", "Sodium 140 ng/dL 134-144"]
NOT_RESULTS = ["Page 1 of 2", "Phone 555-123-4567", "DOB: 02/14/1971", "Patient ID 12345", "Suite 100", "Age 53", "Account 88 mg/dL", "Order 12 13-14 mg/dL", "We looked at 3 things today."]
UNKNOWN_TEST = ["Laboratory Report", "Collected: 2021-01-05", "Fictional Marker Alpha 12 ng/mL 5-20"]
