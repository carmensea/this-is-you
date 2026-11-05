"""Imports that a real SIGKILL interrupts. Each crash happens in another process, on fictional records."""
from __future__ import annotations

import hashlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import select

from this_is_you.documents import RECOVERED_PREFIX
from this_is_you.models import ExtractionRun, ImportEvent

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, make_pdf, upload
from .test_imports import listing, report, send, start, summary

BACKEND = Path(__file__).resolve().parents[1]


def killed_at(stage: str, data_dir: Path, tmp_path: Path, batch: str = "", item: int = 0, body: bytes = b"") -> None:
    held = tmp_path / "body.bin"
    held.write_bytes(body)
    done = subprocess.run([sys.executable, "-m", "tests.crash_runner", stage, str(data_dir), batch, str(item), str(held)], cwd=BACKEND, capture_output=True, timeout=120)
    assert done.returncode == -9, done.stderr.decode()[-800:]


def documents(client) -> list[dict]:
    return client.get("/api/documents").json()["documents"]


def rows(client, batch) -> dict[str, dict]:
    return {i["path"]: i for i in report(client, batch)["items"]}


def snapshot(client, batch) -> tuple:
    """Everything a person can see about the import, for comparing one restart with the next."""
    client.app.state.extraction.wait_idle()
    with client.app.state.sessions() as session:
        runs = len(session.scalars(select(ExtractionRun)).all())
        events = len(session.scalars(select(ImportEvent)).all())
    return (sorted((d["id"], d["sha256"], d["original_filename"], d["extraction_status"]) for d in documents(client)), sorted((i["path"], i["state"], i["document_id"]) for i in report(client, batch)["items"]), summary(client, batch)["counts"], runs, events)


def assert_one_outcome_each(client, data_dir: Path, batch: str, files: dict[str, bytes]) -> None:
    """The report and the Documents view tell one story, and every byte is what was sent."""
    client.app.state.extraction.wait_idle()
    shown = documents(client)
    items = rows(client, batch)
    assert {d["sha256"] for d in shown} == {hashlib.sha256(b).hexdigest() for b in files.values()}
    assert len(shown) == len(set(files.values()))
    assert not [d for d in shown if d["original_filename"].startswith(RECOVERED_PREFIX)]
    stored = [i for i in items.values() if i["state"] == "stored"]
    assert sorted(i["document_id"] for i in stored) == sorted(d["id"] for d in shown), "one stored row for each document"
    assert all(i["state"] in ("stored", "duplicate") for i in items.values())
    assert all(i["document_id"] for i in items.values())
    for path, body in files.items():
        document = next(d for d in shown if d["id"] == items[path]["document_id"])
        assert document["sha256"] == hashlib.sha256(body).hexdigest()
        assert client.get(f"/api/documents/{document['id']}/content").content == body
    with client.app.state.sessions() as session:
        per_document = [r.document_id for r in session.scalars(select(ExtractionRun))]
    assert sorted(per_document) == sorted(d["id"] for d in shown), "each file read once"
    assert not list((data_dir / "incoming").iterdir())


@pytest.mark.parametrize("stage, documents_after_restart", [
    ("before_file", 0),
    ("after_file", 1),
    ("inside_transaction", 1),
    ("after_transaction", 1),
])
def test_a_kill_at_any_stage_of_an_upload_ends_in_one_outcome(data_dir, tmp_path, stage, documents_after_restart):
    files = {"Records/kept.pdf": make_pdf("Fictional kept"), "Records/killed.pdf": make_pdf("Fictional killed")}
    client = client_for(data_dir)
    batch = start(client)
    items = listing(client, batch, files)
    send(client, batch, items["Records/kept.pdf"], files["Records/kept.pdf"])
    client.app.state.extraction.wait_idle()
    killed_at(stage, data_dir, tmp_path, batch, items["Records/killed.pdf"], files["Records/killed.pdf"])

    client = client_for(data_dir)
    assert len(documents(client)) == 1 + documents_after_restart
    assert summary(client, batch)["total"] == 2
    # Resuming: the same folder is listed again and every file offered, as the page does.
    assert listing(client, batch, files) == items
    for path, body in files.items():
        assert send(client, batch, items[path], body).status_code == 200
    assert_one_outcome_each(client, data_dir, batch, files)
    assert rows(client, batch)["Records/killed.pdf"]["state"] == "stored"
    assert rows(client, batch)["Records/killed.pdf"]["document_filename"] == "killed.pdf"
    assert set(summary(client, batch)["counts"]) <= {"read", "no_text", "partial"}
    assert "duplicate" not in summary(client, batch)["counts"]


def test_recovery_can_be_repeated_and_changes_nothing_more(data_dir, tmp_path):
    files = {"Records/a.pdf": pdfs.text_pdf(pdfs.LAB_REPORT)}
    client = client_for(data_dir)
    batch = start(client)
    item = listing(client, batch, files)["Records/a.pdf"]
    killed_at("after_file", data_dir, tmp_path, batch, item, files["Records/a.pdf"])
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 1
    first = snapshot(client, batch)
    for _ in range(3):
        client = client_for(data_dir)
        assert client.app.state.reconciled.recovered == 0
        assert snapshot(client, batch) == first
    send(client, batch, item, files["Records/a.pdf"])
    settled = snapshot(client, batch)
    for _ in range(3):
        client = client_for(data_dir)
        assert client.app.state.reconciled.recovered == 0
        assert snapshot(client, batch) == settled
        assert send(client, batch, item, files["Records/a.pdf"]).json()["state"] == "stored"  # Sending it again adds nothing.
        assert snapshot(client, batch) == settled


def test_a_kill_partway_through_recovering_several_files(data_dir, tmp_path):
    client = client_for(data_dir)
    files = {f"Records/{n}.pdf": make_pdf(f"Fictional {n}") for n in "abc"}
    batch = start(client)
    items = listing(client, batch, files)
    for body in files.values():
        sha = hashlib.sha256(body).hexdigest()
        target = data_dir / "originals" / sha[:2] / sha[2:4] / f"{sha}.pdf"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    killed_at("during_recovery", data_dir, tmp_path)
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 2  # One was recorded before the kill.
    assert len(documents(client)) == 3
    client.app.state.extraction.wait_idle()  # A real restart never has two services on one archive.
    client = client_for(data_dir)
    assert client.app.state.reconciled.recovered == 0
    for path, body in files.items():
        send(client, batch, items[path], body)
    assert_one_outcome_each(client, data_dir, batch, files)


def test_a_recovered_file_and_a_real_duplicate_of_it_are_told_apart(data_dir, tmp_path):
    body = make_pdf("Fictional twins")
    files = {"Records/first.pdf": body, "Records/copy of first.pdf": body}
    client = client_for(data_dir)
    batch = start(client)
    items = listing(client, batch, files)
    killed_at("after_file", data_dir, tmp_path, batch, items["Records/first.pdf"], body)
    client = client_for(data_dir)
    assert send(client, batch, items["Records/first.pdf"], body).json()["state"] == "stored"
    assert send(client, batch, items["Records/copy of first.pdf"], body).json()["state"] == "duplicate"
    assert_one_outcome_each(client, data_dir, batch, files)
    assert summary(client, batch)["counts"]["duplicate"] == 1
    assert documents(client)[0]["original_filename"] == "first.pdf"


def test_a_later_import_of_a_recovered_file_is_a_real_duplicate(data_dir, tmp_path):
    body = make_pdf("Fictional later")
    files = {"Records/a.pdf": body}
    client = client_for(data_dir)
    batch = start(client)
    item = listing(client, batch, files)["Records/a.pdf"]
    killed_at("after_file", data_dir, tmp_path, batch, item, body)
    client = client_for(data_dir)
    assert send(client, batch, item, body).json()["state"] == "stored"
    later = start(client, "Later folder")
    again = listing(client, later, {"Later/renamed.pdf": body})["Later/renamed.pdf"]
    assert send(client, later, again, body).json()["state"] == "duplicate"
    assert [d["original_filename"] for d in documents(client)] == ["a.pdf"]
    assert summary(client, later)["counts"] == {"duplicate": 1}


def test_an_ordinary_duplicate_is_still_a_duplicate(data_dir):
    body = make_pdf("Fictional ordinary")
    files = {"Records/one.pdf": body, "Records/two.pdf": body}
    client = client_for(data_dir)
    batch = start(client)
    items = listing(client, batch, files)
    states = [send(client, batch, items[p], body).json()["state"] for p in files]
    assert states == ["stored", "duplicate"]
    with client.app.state.sessions() as session:
        assert [e.outcome.value for e in session.scalars(select(ImportEvent).order_by(ImportEvent.id))] == ["stored", "duplicate"]


def test_a_file_someone_named_like_a_recovered_one_is_not_mistaken_for_one(data_dir):
    body = make_pdf("Fictional lookalike")
    client = client_for(data_dir)
    assert upload(client, body, f"{RECOVERED_PREFIX}000000000000.pdf").json()["duplicate"] is False
    batch = start(client)
    item = listing(client, batch, {"Records/real name.pdf": body})["Records/real name.pdf"]
    assert send(client, batch, item, body).json()["state"] == "duplicate"
    assert documents(client)[0]["original_filename"] == f"{RECOVERED_PREFIX}000000000000.pdf"


def test_each_attempt_is_kept_in_the_document_history(data_dir, tmp_path):
    body = make_pdf("Fictional history")
    client = client_for(data_dir)
    batch = start(client)
    item = listing(client, batch, {"Records/a.pdf": body})["Records/a.pdf"]
    killed_at("after_file", data_dir, tmp_path, batch, item, body)
    client = client_for(data_dir)
    send(client, batch, item, body)
    later = start(client, "Later")
    send(client, later, listing(client, later, {"Later/a.pdf": body})["Later/a.pdf"], body)
    detail = client.get(f"/api/documents/{documents(client)[0]['id']}").json()
    names = [(e["outcome"], e["submitted_filename"].startswith(RECOVERED_PREFIX)) for e in detail["imports"]]
    assert names == [("stored", True), ("stored", False), ("duplicate", False)]
    assert rows(client, batch)["Records/a.pdf"]["message"]  # The row says it was recovered.


def test_claiming_a_recovered_file_preserves_everything_a_person_did(data_dir, tmp_path):
    body = pdfs.text_pdf(pdfs.CBC_VALUE_UNIT_RANGE)
    client = client_for(data_dir)
    batch = start(client)
    item = listing(client, batch, {"Records/cbc.pdf": body})["Records/cbc.pdf"]
    killed_at("after_file", data_dir, tmp_path, batch, item, body)
    client = client_for(data_dir)
    client.app.state.extraction.wait_idle()
    document = documents(client)[0]["id"]
    observed = [o for o in client.get("/api/observations").json()["observations"] if o["document_id"] == document]
    assert len(observed) >= 2
    assert client.post(f"/api/observations/{observed[0]['id']}/verify", headers=CLIENT_HEADERS).status_code == 200
    before = client.get("/api/observations").json()["observations"]
    detail = client.get(f"/api/documents/{document}").json()

    assert send(client, batch, item, body).json()["state"] == "stored"
    client.app.state.extraction.wait_idle()

    assert client.get("/api/observations").json()["observations"] == before
    after = client.get(f"/api/documents/{document}").json()
    changed = {k for k in detail if detail[k] != after[k]}
    assert changed <= {"original_filename", "imports"}, changed
    assert after["sha256"] == hashlib.sha256(body).hexdigest() and client.get(f"/api/documents/{document}/content").content == body
    assert sum(o["verification_status"] == "verified" for o in after_observations(client)) == 1
    with client.app.state.sessions() as session:
        assert len(session.scalars(select(ExtractionRun)).all()) == 1, "not read again"


def after_observations(client) -> list[dict]:
    return client.get("/api/observations").json()["observations"]


def test_copies_arriving_together_leave_one_stored_row(data_dir, tmp_path):
    body = make_pdf("Fictional together")
    files = {f"Records/{n}.pdf": body for n in range(6)}
    client = client_for(data_dir)
    batch = start(client)
    items = listing(client, batch, files)
    killed_at("after_file", data_dir, tmp_path, batch, items["Records/0.pdf"], body)
    client = client_for(data_dir)
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda path: send(client, batch, items[path], body), files))
    assert sorted(a.json()["state"] for a in answers) == ["duplicate"] * 5 + ["stored"]
    assert_one_outcome_each(client, data_dir, batch, files)
