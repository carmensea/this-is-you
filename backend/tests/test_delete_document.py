"""Deleting a document for good, including real kills partway. Every record here is fictional."""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import func, select

from this_is_you.backup import create_backup, verify_backup
from this_is_you.models import Document, ExtractionRun, ExtractionStatus, ImportBatch, ImportEvent, ImportItem, MetadataDecision, MetadataProposal, Observation, ObservationRevision, ReviewGroupApproval

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, make_pdf, upload
from .test_imports import listing, report, send, start, summary

BACKEND = Path(__file__).resolve().parents[1]
TABLES = (Document, ExtractionRun, MetadataProposal, MetadataDecision, Observation, ObservationRevision, ReviewGroupApproval, ImportEvent, ImportItem)
MINE = pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE)
OTHER = pdfs.text_pdf(["Fictional Portal", "Collected on Mar 5, 2024 9:12 AM", "Glucose 90 mg/dL 65 - 99 mg/dL", "Sodium 140 mmol/L 134 - 144 mmol/L"])


def counts(client) -> dict[str, int]:
    with client.app.state.sessions() as session:
        return {t.__name__: session.scalar(select(func.count()).select_from(t)) for t in TABLES}


def on_disk(data_dir: Path, body: bytes) -> Path:
    sha = hashlib.sha256(body).hexdigest()
    return data_dir / "originals" / sha[:2] / sha[2:4] / f"{sha}.pdf"


def remove(client, document):
    return client.delete(f"/api/documents/{document}", headers=CLIENT_HEADERS)


def two_documents(client) -> tuple[str, str, str]:
    batch = start(client)
    items = listing(client, batch, {"Records/wrong.pdf": OTHER, "Records/mine.pdf": MINE})
    wrong = send(client, batch, items["Records/wrong.pdf"], OTHER).json()["document_id"]
    mine = send(client, batch, items["Records/mine.pdf"], MINE).json()["document_id"]
    client.app.state.extraction.wait_idle()
    return batch, wrong, mine


def killed(stage: str, data_dir: Path, document: str) -> None:
    done = subprocess.run([sys.executable, "-m", "tests.crash_runner", stage, str(data_dir), document], cwd=BACKEND, capture_output=True, timeout=120)
    assert done.returncode == -9, done.stderr.decode()[-800:]


def test_it_removes_the_file_and_everything_read_from_it_and_nothing_else(client, data_dir):
    batch, wrong, mine = two_documents(client)
    observed = [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == mine]
    client.post(f"/api/observations/{observed[0]['id']}/verify", headers=CLIENT_HEADERS)
    keep_detail = client.get(f"/api/documents/{mine}").json()
    keep_rows = [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == mine]

    assert remove(client, wrong).status_code == 204

    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [mine]
    assert client.get(f"/api/documents/{wrong}").status_code == 404
    assert client.get(f"/api/documents/{wrong}/content").status_code == 404
    assert not on_disk(data_dir, OTHER).exists()
    assert on_disk(data_dir, MINE).read_bytes() == MINE
    assert client.get(f"/api/documents/{mine}").json() == keep_detail
    assert client.get("/api/observations").json()["observations"] == keep_rows
    assert [i["path"] for i in report(client, batch)["items"]] == ["Records/mine.pdf"]
    assert summary(client, batch)["total"] == 1
    assert not list((data_dir / "deleting").iterdir())
    with client.app.state.sessions() as session:
        assert not session.scalars(select(ImportEvent).where(ImportEvent.document_id == wrong)).all()
        assert not session.scalars(select(ExtractionRun).where(ExtractionRun.document_id == wrong)).all()
        orphans = session.scalar(select(func.count()).select_from(ObservationRevision).where(ObservationRevision.observation_id.not_in(select(Observation.id))))
        assert orphans == 0
        assert session.connection().exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []


def test_nothing_it_knew_survives_in_the_database_file(data_dir):
    client = client_for(data_dir)
    secret = "Zephyrine Fictional Marker"
    body = pdfs.text_pdf(["Fictional Portal", "Collected on Mar 5, 2024 9:12 AM", f"{secret} 90 mg/dL 65 - 99 mg/dL"])
    document = upload(client, body, "zephyrine fictional scan.pdf").json()["document"]["id"]
    client.app.state.extraction.wait_idle()
    assert remove(client, document).status_code == 204
    held = b"".join(p.read_bytes() for p in data_dir.iterdir() if p.is_file())
    assert secret.encode() not in held and b"zephyrine" not in held.lower()


def test_decisions_and_group_approvals_go_with_it(client):
    _, wrong, mine = two_documents(client)
    rows = [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == wrong and o["group_eligible"]]
    assert rows
    body = {"document_id": wrong, "group": rows[0]["review_group"], "collected_on": rows[0]["collected_on"], "items": [{"id": o["id"], "version": o["version"]} for o in rows if o["review_group"] == rows[0]["review_group"]]}
    assert client.post("/api/observations/approve-group", json=body, headers=CLIENT_HEADERS).status_code == 200
    proposal = client.get(f"/api/documents/{wrong}").json()["metadata"]["service_date"]["proposal"]["id"]
    assert client.post(f"/api/documents/{wrong}/metadata/service_date", json={"action": "confirmed", "proposal_id": proposal}, headers=CLIENT_HEADERS).status_code == 200
    assert remove(client, wrong).status_code == 204
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ReviewGroupApproval)) == 0
        assert session.scalar(select(func.count()).select_from(MetadataDecision)) == 0
    assert client.get(f"/api/documents/{mine}").status_code == 200


def test_a_report_with_nothing_left_goes_too(client):
    body = make_pdf("Fictional alone")
    batch = start(client)
    item = listing(client, batch, {"Records/alone.pdf": body})["Records/alone.pdf"]
    document = send(client, batch, item, body).json()["document_id"]
    client.app.state.extraction.wait_idle()
    assert remove(client, document).status_code == 204
    assert client.get("/api/import-batches").json()["batches"] == []
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ImportBatch)) == 0


def test_copies_in_the_report_go_too_and_other_rows_stay(client):
    body = make_pdf("Fictional copied")
    batch = start(client)
    files = {"Records/one.pdf": body, "Records/copy.pdf": body, "Records/notes.txt": b"x"}
    items = listing(client, batch, files)
    document = send(client, batch, items["Records/one.pdf"], body).json()["document_id"]
    send(client, batch, items["Records/copy.pdf"], body)
    client.app.state.extraction.wait_idle()
    assert remove(client, document).status_code == 204
    assert [i["path"] for i in report(client, batch)["items"]] == ["Records/notes.txt"]


def test_it_can_be_imported_again_only_if_someone_chooses_to(client, data_dir):
    _, wrong, _ = two_documents(client)
    remove(client, wrong)
    again = upload(client, OTHER, "wrong.pdf").json()
    assert again["duplicate"] is False and again["document"]["id"] != wrong
    client.app.state.extraction.wait_idle()
    assert on_disk(data_dir, OTHER).read_bytes() == OTHER


def test_it_is_refused_while_the_document_is_being_read(client, data_dir):
    _, wrong, _ = two_documents(client)
    before = counts(client)
    with client.app.state.sessions() as session:
        session.get(Document, wrong).extraction_status = ExtractionStatus.RUNNING
        session.commit()
    answer = remove(client, wrong)
    assert answer.status_code == 409 and "still being read" in answer.text
    assert counts(client) == before and on_disk(data_dir, OTHER).exists()


def test_an_unknown_document_is_not_found(client):
    assert remove(client, "a" * 32).status_code == 404
    assert client.delete("/api/documents/not-an-id", headers=CLIENT_HEADERS).status_code == 422


def test_it_needs_the_app_and_a_signed_in_person(client):
    _, wrong, _ = two_documents(client)
    assert client.delete(f"/api/documents/{wrong}").status_code == 403
    client.cookies.clear()
    assert remove(client, wrong).status_code == 401
    client2 = client_for(client.app.state.settings.data_dir)
    assert client2.get(f"/api/documents/{wrong}").status_code == 200


def test_a_kill_after_the_rows_go_does_not_bring_it_back(data_dir):
    client = client_for(data_dir)
    batch, wrong, mine = two_documents(client)
    killed("delete_after_commit", data_dir, wrong)
    assert on_disk(data_dir, OTHER).exists() and (data_dir / "deleting" / hashlib.sha256(OTHER).hexdigest()).exists()
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 0
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [mine]
    assert not on_disk(data_dir, OTHER).exists() and not list((data_dir / "deleting").iterdir())
    assert on_disk(data_dir, MINE).read_bytes() == MINE
    assert summary(client, batch)["total"] == 1
    again = client_for(data_dir)
    assert again.app.state.reconciled.recovered == 0 and len(again.get("/api/documents").json()["documents"]) == 1


def test_a_kill_before_the_rows_go_deletes_nothing(data_dir):
    client = client_for(data_dir)
    batch, wrong, mine = two_documents(client)
    before = counts(client)
    killed("delete_inside_transaction", data_dir, wrong)
    client = client_for(data_dir)
    assert counts(client) == before and on_disk(data_dir, OTHER).read_bytes() == OTHER
    assert not list((data_dir / "deleting").iterdir())
    assert client.app.state.reconciled.recovered == 0
    assert remove(client, wrong).status_code == 204
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [mine]


def test_a_stray_note_in_the_deleting_folder_harms_nothing(data_dir):
    client = client_for(data_dir)
    _, wrong, mine = two_documents(client)
    (data_dir / "deleting").mkdir(exist_ok=True)
    (data_dir / "deleting" / "not-a-hash").write_text("fictional")
    client = client_for(data_dir)
    assert len(client.get("/api/documents").json()["documents"]) == 2


def test_a_backup_made_after_a_delete_checks_out_and_does_not_hold_it(client, data_dir, tmp_path):
    _, wrong, mine = two_documents(client)
    remove(client, wrong)
    result = create_backup(data_dir / "archive.sqlite3", data_dir / "originals", tmp_path / "backups")
    assert verify_backup(result.path).ok
    held = [p for p in result.path.rglob("*") if p.is_file()]
    assert any(p.name == f"{hashlib.sha256(MINE).hexdigest()}.pdf" for p in held)
    assert not any(hashlib.sha256(OTHER).hexdigest() in p.name for p in held)
