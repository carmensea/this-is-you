"""Batch imports: every file accounted for, nothing duplicated, and a report that outlasts everything."""
from __future__ import annotations

import hashlib

import pytest
from sqlalchemy import func, select

from this_is_you.models import Document, ImportEvent, ImportItem

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, make_pdf


def start(client, label="Records") -> str:
    return client.post("/api/import-batches", json={"label": label}, headers=CLIENT_HEADERS).json()["id"]


def listing(client, batch, files: dict[str, bytes]) -> dict[str, int]:
    body = {"items": [{"path": p, "size": len(b), "modified": 1} for p, b in files.items()]}
    response = client.post(f"/api/import-batches/{batch}/items", json=body, headers=CLIENT_HEADERS)
    assert response.status_code == 200
    return {path: i["id"] for path, i in zip(files, response.json()["items"])}


def send(client, batch, item, body: bytes):
    return client.post(f"/api/import-batches/{batch}/items/{item}/file", content=body, headers={**CLIENT_HEADERS, "content-type": "application/pdf"})


def report(client, batch, **query):
    return client.get(f"/api/import-batches/{batch}/items", params=query).json()


def summary(client, batch) -> dict:
    return next(b for b in client.get("/api/import-batches").json()["batches"] if b["id"] == batch)


MESSY = {
    "Records/2019/labs/cbc.pdf": pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE),
    "Records/2019/labs/copy of cbc.PDF": pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE),
    "Records/2020/deep/er/noch/tiefer/scan.pdf": pdfs.image_only_pdf(),
    "Records/2020/mixed.pdf": pdfs.mixed_pdf(pdfs.CBC_VALUE_UNIT_RANGE),
    "Records/locked.pdf": pdfs.encrypted_pdf(pdfs.LAB_REPORT),
    "Records/blank.pdf": pdfs.text_pdf(["x"]),
    "Records/cut off.pdf": pdfs.text_pdf(pdfs.LAB_REPORT)[:120],
    "Records/fake.pdf": b"this is not a pdf at all",
    "Records/empty.pdf": b"",
    "Records/photo.jpg": b"\xff\xd8\xff not sent",
    "Records/.DS_Store": b"junk",
}


def run_all(client, batch, files=MESSY) -> dict[str, int]:
    items = listing(client, batch, files)
    for path, item in items.items():
        if path.lower().endswith(".pdf") and files[path]:
            assert send(client, batch, item, files[path]).status_code == 200
    client.app.state.extraction.wait_idle()
    return items


def test_every_file_of_a_messy_nested_folder_is_accounted_for(client):
    batch = start(client)
    run_all(client, batch)
    s = summary(client, batch)
    assert s["total"] == len(MESSY)
    assert s["counts"] == {"read": 1, "duplicate": 1, "scanned": 1, "partial": 1, "encrypted": 1, "no_text": 1, "failed": 3, "unsupported": 2}
    rows = {r["path"]: r for r in report(client, batch)["items"]}
    assert set(rows) == set(MESSY)
    assert rows["Records/photo.jpg"]["state"] == "unsupported" and "Only PDF" in rows["Records/photo.jpg"]["message"]
    assert rows["Records/.DS_Store"]["state"] == "unsupported"
    assert rows["Records/fake.pdf"]["state"] == "rejected" and "not a readable PDF" in rows["Records/fake.pdf"]["message"]
    assert rows["Records/empty.pdf"]["state"] == "rejected" and "empty" in rows["Records/empty.pdf"]["message"]
    copy = rows["Records/2019/labs/copy of cbc.PDF"]
    assert copy["state"] == "duplicate" and copy["document_filename"] == "cbc.pdf"
    assert copy["document_id"] == rows["Records/2019/labs/cbc.pdf"]["document_id"]


def test_storage_reading_and_verification_are_reported_separately(client):
    batch = start(client)
    run_all(client, batch)
    rows = {r["path"]: r for r in report(client, batch)["items"]}
    scan = rows["Records/2020/deep/er/noch/tiefer/scan.pdf"]
    assert (scan["state"], scan["extraction_status"], scan["verification_status"]) == ("stored", "image_only", "unverified")
    good = rows["Records/2019/labs/cbc.pdf"]
    assert (good["state"], good["extraction_status"], good["verification_status"]) == ("stored", "extracted", "unverified")
    failed = rows["Records/fake.pdf"]
    assert (failed["state"], failed["extraction_status"], failed["verification_status"]) == ("rejected", None, None)


def test_originals_are_stored_byte_for_byte(client):
    batch = start(client)
    run_all(client, batch)
    for row in report(client, batch)["items"]:
        if row["state"] == "stored":
            stored = client.get(f"/api/documents/{row['document_id']}/content").content
            assert hashlib.sha256(stored).hexdigest() == hashlib.sha256(MESSY[row["path"]]).hexdigest()


def test_resuming_after_a_crash_duplicates_nothing(data_dir):
    files = {f"Records/{n}.pdf": make_pdf(f"file {n}") for n in range(6)}
    client = client_for(data_dir)
    batch = start(client)
    items = listing(client, batch, files)
    for path in list(files)[:3]:
        send(client, batch, items[path], files[path])
    client.app.state.extraction.wait_idle()
    # The service stops here. A new one opens the same folder, and the report is still there.
    client = client_for(data_dir)
    s = summary(client, batch)
    assert s["counts"]["waiting"] == 3 and s["total"] == 6
    again = listing(client, batch, files)
    assert again == items
    for path in files:  # Even a client that resends everything adds nothing.
        assert send(client, batch, items[path], files[path]).status_code == 200
    client.app.state.extraction.wait_idle()
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(Document)) == 6
        assert session.scalar(select(func.count()).select_from(ImportEvent)) == 6
        assert session.scalar(select(func.count()).select_from(ImportItem)) == 6
    assert "waiting" not in summary(client, batch)["counts"]


def test_a_crash_between_file_and_record_loses_nothing_on_retry(data_dir, monkeypatch):
    """The file reached the store and the database never heard. The retry finishes the job exactly once."""
    files = {"Records/a.pdf": make_pdf("crash")}
    client = client_for(data_dir)
    batch = start(client)
    item = listing(client, batch, files)["Records/a.pdf"]
    real = client.app.state.store.commit

    def commit_then_die(received):
        real(received)
        raise RuntimeError("simulated crash")

    monkeypatch.setattr(client.app.state.store, "commit", commit_then_die)
    with pytest.raises(RuntimeError):
        send(client, batch, item, files["Records/a.pdf"])
    monkeypatch.undo()
    client = client_for(data_dir)
    assert summary(client, batch)["counts"] == {"waiting": 1}
    # The file is recovered on start. Sending it again finishes the report and gives it back its name.
    assert [d["original_filename"][:15] for d in client.get("/api/documents").json()["documents"]] == ["Recovered file "]
    assert send(client, batch, item, files["Records/a.pdf"]).json()["state"] == "stored"
    assert [d["original_filename"] for d in client.get("/api/documents").json()["documents"]] == ["a.pdf"]


def test_a_crash_while_reading_resumes_on_the_next_start(data_dir):
    client = client_for(data_dir)
    batch = start(client)
    files = {"Records/a.pdf": pdfs.text_pdf(pdfs.LAB_REPORT)}
    item = listing(client, batch, files)["Records/a.pdf"]
    send(client, batch, item, files["Records/a.pdf"])
    client.app.state.extraction.wait_idle()
    with client.app.state.sessions() as session:
        document = session.scalars(select(Document)).one()
        document.extraction_status = "running"
        session.commit()
    client = client_for(data_dir)
    client.app.state.extraction.wait_idle()
    assert summary(client, batch)["counts"] == {"read": 1}


def test_a_failed_reading_can_be_retried_without_losing_anything(client, monkeypatch):
    from this_is_you import metadata
    from this_is_you.extraction.runner import ExtractionResult

    real = metadata.extract
    monkeypatch.setattr(metadata, "extract", lambda path, limits: ExtractionResult("failed"))
    batch = start(client)
    files = {"Records/a.pdf": pdfs.text_pdf(pdfs.LAB_REPORT)}
    item = listing(client, batch, files)["Records/a.pdf"]
    send(client, batch, item, files["Records/a.pdf"])
    client.app.state.extraction.wait_idle()
    assert summary(client, batch)["counts"] == {"failed": 1}
    assert report(client, batch)["items"][0]["state"] == "stored"  # Stored, though the reading failed.
    monkeypatch.setattr(metadata, "extract", real)
    assert client.post(f"/api/import-batches/{batch}/retry-reading", headers=CLIENT_HEADERS).json() == {"requeued": 1}
    client.app.state.extraction.wait_idle()
    assert summary(client, batch)["counts"] == {"read": 1}
    assert client.post(f"/api/import-batches/{batch}/retry-reading", headers=CLIENT_HEADERS).json() == {"requeued": 0}


def test_a_rejected_file_can_be_retried_and_counts_its_attempts(client):
    batch = start(client)
    files = {"Records/a.pdf": b"not yet a pdf"}
    item = listing(client, batch, files)["Records/a.pdf"]
    assert send(client, batch, item, files["Records/a.pdf"]).json()["state"] == "rejected"
    good = make_pdf("repaired")
    row = send(client, batch, item, good).json()
    assert row["state"] == "stored" and row["attempts"] == 2 and row["message"] is None


def test_a_report_filters_pages_and_removes_only_itself(client):
    batch = start(client)
    run_all(client, batch)
    failed = report(client, batch, category="failed")
    assert failed["total"] == 3 and all(r["state"] == "rejected" for r in failed["items"])
    page = report(client, batch, limit=4, offset=8)
    assert page["total"] == len(MESSY) and len(page["items"]) == 3
    documents = len(client.get("/api/documents").json()["documents"])
    assert client.delete(f"/api/import-batches/{batch}", headers=CLIENT_HEADERS).status_code == 204
    assert client.get("/api/import-batches").json()["batches"] == []
    assert client.get(f"/api/import-batches/{batch}/items").status_code == 404
    assert len(client.get("/api/documents").json()["documents"]) == documents


def test_batch_paths_are_only_text(client, data_dir):
    batch = start(client)
    hostile = {"../../../etc/passwd.pdf": make_pdf("hostile"), "Records/ünï çødé 日本語.pdf": make_pdf("unicode"), "C:\\Users\\x\\win.pdf": make_pdf("windows")}
    run_all(client, batch, hostile)
    rows = report(client, batch)["items"]
    assert {r["state"] for r in rows} == {"stored"}
    assert {d["original_filename"] for d in client.get("/api/documents").json()["documents"]} == {"passwd.pdf", "ünï çødé 日本語.pdf", "win.pdf"}
    assert all(p.is_relative_to(data_dir) for p in (data_dir / "originals").rglob("*"))


def test_a_percent_sign_in_a_folder_path_is_kept_as_it_was(client):
    batch = start(client)
    run_all(client, batch, {"Records/100%25 done %zz.pdf": make_pdf("percent")})
    assert client.get("/api/documents").json()["documents"][0]["original_filename"] == "100%25 done %zz.pdf"


def test_a_file_over_the_limit_is_listed_not_sent(data_dir):
    client = client_for(data_dir, max_upload_bytes=1024 * 1024)
    batch = start(client)
    body = {"items": [{"path": "Records/huge.pdf", "size": 2 * 1024 * 1024, "modified": 1}]}
    row = client.post(f"/api/import-batches/{batch}/items", json=body, headers=CLIENT_HEADERS).json()["items"][0]
    assert row["state"] == "unsupported"
    assert send(client, batch, row["id"], b"x").status_code == 409
    assert "1 MB limit" in report(client, batch)["items"][0]["message"]


def test_an_item_from_another_batch_is_refused(client):
    a, b = start(client, "a"), start(client, "b")
    item = listing(client, a, {"Records/a.pdf": make_pdf("x")})["Records/a.pdf"]
    assert send(client, b, item, make_pdf("x")).status_code == 404


def test_other_websites_cannot_start_or_feed_an_import(client):
    assert client.post("/api/import-batches", json={"label": "x"}).status_code == 403
    assert client.post("/api/import-batches", json={"label": "x"}, headers={**CLIENT_HEADERS, "sec-fetch-site": "cross-site"}).status_code == 403
    assert client.put("/api/identity", json={"full_name": "A B"}).status_code == 403
