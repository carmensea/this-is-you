"""Fills a throwaway archive with fictional records for performance tests.

Usage: seed.py BASE_URL DATA_DIR PDF_COUNT MANUAL_ROWS
The caller has already started the backend with THIS_IS_YOU_DATA_DIR=DATA_DIR.
Every value here is invented and deterministic, so two runs compare the same archive.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "backend"), str(REPO / "backend" / "tests")]

CLIENT = {"X-This-Is-You-Client": "1"}
EXTRACTING = {"pending", "running"}


def call(url: str, data: bytes | None = None, headers: dict | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def report_lines(day: date, rng: random.Random) -> list[str]:
    return [
        "Fictional Reference Laboratory",
        "Laboratory Report",
        f"Collection Date: {day.isoformat()}",
        f"Hemoglobin {rng.uniform(12.5, 16.5):.1f} g/dL 13.0-17.7",
        f"Glucose {rng.randint(70, 110)} mg/dL 65-99",
        f"LDL Cholesterol {rng.randint(70, 170)} mg/dL 0-99",
        f"TSH {rng.uniform(0.6, 4.2):.3f} uIU/mL 0.450-4.500",
    ]


def seed_documents(base: str, count: int, rng: random.Random) -> None:
    from pdfs import text_pdf

    for n in range(count):
        day = date(2010, 1, 15) + timedelta(days=n * 5400 // max(count, 1))
        # Every tenth file is long, so previews cover more than one-page PDFs.
        pages = [report_lines(day, rng)] + ([[f"Fictional page {p}"] * 30 for p in range(40)] if n % 10 == 0 else [])
        call(
            f"{base}/api/documents",
            text_pdf(*pages),
            {**CLIENT, "Content-Type": "application/pdf", "X-Original-Filename": f"synthetic-report-{n:04}.pdf"},
        )
    deadline = time.time() + 600
    while time.time() < deadline:
        documents = call(f"{base}/api/documents")["documents"]
        if not any(d["extraction_status"] in EXTRACTING for d in documents):
            break
        time.sleep(0.5)
    else:
        raise SystemExit("Extraction did not finish.")
    proposed = [o["id"] for o in call(f"{base}/api/observations")["observations"] if o["verification_status"] == "proposed"]
    for observation_id in proposed:
        call(f"{base}/api/observations/{observation_id}/verify", b"{}", {**CLIENT, "Content-Type": "application/json"})


def seed_manual_rows(data_dir: str, rows: int, rng: random.Random) -> None:
    # Written directly: each POST lists every row in the archive, which is too slow to seed thousands through.
    from sqlalchemy.orm import sessionmaker

    os.environ["THIS_IS_YOU_DATA_DIR"] = data_dir
    from this_is_you.config import load_settings
    from this_is_you.db import make_engine
    from this_is_you.lab_catalog import TESTS
    from this_is_you.observations import ManualEntry, create_manual

    sessions = sessionmaker(make_engine(load_settings().database_path), expire_on_commit=False)
    draws = rows // len(TESTS) + 1
    made = 0
    for draw in range(draws):
        day = date(2009, 2, 1) + timedelta(days=draw * 6000 // draws)
        for test in TESTS:
            if made == rows:
                return
            fields = {
                "reported_name": test.name,
                "value_text": f"{rng.uniform(1, 200):.1f}",
                "unit": test.unit,
                "reference_text": "1-150",
                "lab_name": "Fictional Reference Laboratory",
                "collected_on": day.isoformat(),
            }
            create_manual(sessions, ManualEntry(fields, None, True))
            made += 1


def main() -> None:
    base, data_dir, pdf_count, manual_rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    rng = random.Random(20261102)
    seed_documents(base, pdf_count, rng)
    seed_manual_rows(data_dir, manual_rows, rng)
    observations = call(f"{base}/api/observations")["observations"]
    verified = sum(o["verification_status"] == "verified" for o in observations)
    print(f"{len(call(f'{base}/api/documents')['documents'])} documents, {verified}/{len(observations)} results verified")


if __name__ == "__main__":
    main()
