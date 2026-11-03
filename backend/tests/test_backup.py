"""Backups: consistency under load, damage of every kind, and restores that cannot harm what is there."""
from __future__ import annotations

import hashlib
import json
import os
import pty
import sqlite3
import stat
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from this_is_you import backup
from this_is_you.backup import BackupProblem, check_archive, create_backup, hold_service_lock, restore_backup, trial_restore, verify_backup
from this_is_you.config import Settings, UnsafeConfiguration, validate

from . import pdfs
from .conftest import CLIENT_HEADERS, client_for, make_pdf, upload


def seeded(data_dir: Path, documents: int = 3):
    client = client_for(data_dir)
    ids = []
    for n in range(documents):
        ids.append(upload(client, pdfs.text_pdf(pdfs.LAB_REPORT + [f"Fictional line {n}"]), f"lab {n}.pdf").json()["document"]["id"])
    client.app.state.extraction.wait_idle()
    observation = client.get("/api/observations").json()["observations"][0]
    client.post(f"/api/observations/{observation['id']}/correct", json={"fields": {"value_text": "15.1"}}, headers=CLIENT_HEADERS)
    client.post(f"/api/observations/{observation['id']}/verify", headers=CLIENT_HEADERS)
    client.post(f"/api/documents/{ids[0]}/metadata/provider", json={"action": "corrected", "value": "Fictional Clinic"}, headers=CLIENT_HEADERS)
    client.put("/api/identity", json={"full_name": "Avery Testperson", "date_of_birth": "1971-02-14"}, headers=CLIENT_HEADERS)
    return client, ids


def make(data_dir: Path, tmp_path: Path):
    return create_backup(data_dir / "archive.sqlite3", data_dir / "originals", tmp_path / "backups")


def rewrite_manifest(folder: Path, change) -> None:
    path = folder / backup.MANIFEST
    path.chmod(0o600)
    manifest = json.loads(path.read_text())
    change(manifest)
    manifest["manifest_sha256"] = backup._manifest_hash(manifest)
    path.write_text(json.dumps(manifest))


def writable(file: Path) -> Path:
    file.chmod(0o600)
    return file


def first_original(folder: Path) -> Path:
    return next((folder / "originals").rglob("*.pdf"))


def test_a_backup_holds_everything_and_passes_its_check(data_dir, tmp_path):
    seeded(data_dir)
    result = make(data_dir, tmp_path)
    check = verify_backup(result.path)
    assert check.ok, check.problems
    manifest = check.manifest
    assert manifest["format_version"] == backup.FORMAT_VERSION and manifest["schema_revision"] == "0004"
    assert manifest["counts"]["documents"] == 3 and manifest["counts"]["lab_observation_revisions"] >= 3 and manifest["counts"]["metadata_decisions"] == 1 and manifest["counts"]["identity_profile"] == 1
    assert {f["path"] for f in manifest["files"]} >= {"archive.sqlite3"}
    assert stat.S_IMODE(result.path.stat().st_mode) == 0o700
    assert not list(result.path.glob("*-wal")) and not list(result.path.glob("*-shm"))


def test_restoring_into_a_new_folder_keeps_relationships_history_and_bytes(data_dir, tmp_path):
    client, ids = seeded(data_dir)
    before_docs = client.get("/api/documents").json()
    before_obs = client.get("/api/observations").json()
    before_bytes = {i: client.get(f"/api/documents/{i}/content").content for i in ids}
    restored = tmp_path / "restored"
    assert restore_backup(make(data_dir, tmp_path).path, restored) is None
    assert check_archive(restored) == []
    other = client_for(restored)
    assert other.get("/api/documents").json() == before_docs
    assert other.get("/api/observations").json() == before_obs
    corrected = [o for o in other.get("/api/observations").json()["observations"] if o["edited"]][0]
    assert corrected["original"]["value_text"] == "14.2" and corrected["value_text"] == "15.1" and [r["action"] for r in corrected["revisions"]] == ["extracted", "corrected", "verified"]
    assert other.get("/api/identity").json()["full_name"] == "Avery Testperson"
    for i, body in before_bytes.items():
        assert other.get(f"/api/documents/{i}/content").content == body
    connection = sqlite3.connect(restored / "archive.sqlite3")
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    connection.close()


def test_a_snapshot_is_consistent_while_writes_continue_in_wal_mode(data_dir, tmp_path):
    client, _ = seeded(data_dir, 1)
    stop = threading.Event()
    writer = sqlite3.connect(data_dir / "archive.sqlite3", check_same_thread=False, timeout=30)
    assert writer.execute("PRAGMA journal_mode").fetchone()[0] == "wal"

    def keep_writing() -> None:
        n = 0
        while not stop.is_set():
            n += 1
            # Two rows per transaction: a torn copy would show an odd number of them.
            writer.execute("INSERT INTO import_batches (id, label, created_at, hidden) VALUES (?, 'a', 't', 0)", (f"{n:032x}",))
            writer.execute("INSERT INTO import_batches (id, label, created_at, hidden) VALUES (?, 'b', 't', 0)", (f"b{n:031x}",))
            writer.commit()

    thread = threading.Thread(target=keep_writing)
    thread.start()
    try:
        results = [make(data_dir, tmp_path / str(n)) for n in range(4)]
    finally:
        stop.set()
        thread.join()
        writer.close()
    seen = set()
    for result in results:
        assert verify_backup(result.path).ok
        connection = sqlite3.connect(result.path / "archive.sqlite3")
        count = connection.execute("SELECT COUNT(*) FROM import_batches").fetchone()[0]
        connection.close()
        assert count % 2 == 0
        seen.add(count)
    assert len(seen) > 1 or max(seen) > 0


def test_a_committed_row_only_in_the_wal_is_in_the_backup_and_an_open_transaction_is_not(data_dir, tmp_path):
    seeded(data_dir, 1)
    writer = sqlite3.connect(data_dir / "archive.sqlite3")
    writer.execute("PRAGMA wal_autocheckpoint=0")
    writer.execute("INSERT INTO import_batches (id, label, created_at, hidden) VALUES ('c', 'committed', 't', 0)")
    writer.commit()
    assert (data_dir / "archive.sqlite3-wal").stat().st_size > 0
    writer.execute("INSERT INTO import_batches (id, label, created_at, hidden) VALUES ('u', 'uncommitted', 't', 0)")
    result = make(data_dir, tmp_path)
    writer.rollback()
    writer.close()
    connection = sqlite3.connect(result.path / "archive.sqlite3")
    assert [r[0] for r in connection.execute("SELECT label FROM import_batches")] == ["committed"]
    connection.close()


def test_an_interrupted_backup_never_looks_like_a_backup(data_dir, tmp_path, monkeypatch):
    seeded(data_dir)
    real = backup._copy_private
    calls = {"n": 0}

    def fails(source, target):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real(source, target)

    monkeypatch.setattr(backup, "_copy_private", fails)
    with pytest.raises(OSError):
        make(data_dir, tmp_path)
    assert list((tmp_path / "backups").iterdir()) == []


def test_a_crash_leaves_an_incomplete_folder_that_is_refused_listed_and_cleared(data_dir, tmp_path):
    client = client_for(data_dir, backups_dir_override=tmp_path / "backups")
    upload(client, make_pdf("one"))
    jobs = client.app.state.backups
    leftover = tmp_path / "backups" / "this-is-you-backup-20260101T000000Z.incomplete"
    (leftover / "originals").mkdir(parents=True)
    (leftover / backup.DATABASE).write_bytes(b"partial")
    assert not verify_backup(leftover).ok
    with pytest.raises(BackupProblem):
        restore_backup(leftover, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()
    assert [b["state"] for b in client.get("/api/backups").json()["backups"]] == ["incomplete"]
    assert client.post("/api/backups", headers=CLIENT_HEADERS).status_code == 202
    jobs.wait()
    listing = client.get("/api/backups").json()
    assert [b["state"] for b in listing["backups"]] == ["complete"]
    assert listing["backups"][0]["last_check"]["ok"] is True
    assert listing["last_result"]["ok"] is True


@pytest.mark.parametrize("damage, expected", [
    (lambda f: writable(first_original(f)).write_bytes(b"%PDF-1.4 changed %%EOF"), "does not match"),
    (lambda f: writable(first_original(f)).unlink(), "missing"),
    (lambda f: (f / "archive.sqlite3").chmod(0o600) or (f / "archive.sqlite3").write_bytes(b"not a database"), "damaged"),
    (lambda f: (f / "archive.sqlite3").chmod(0o600) or (f / "archive.sqlite3").unlink(), "missing"),
    (lambda f: (f / backup.MANIFEST).unlink(), "no manifest"),
    (lambda f: (f / backup.MANIFEST).write_text("{ not json"), "damaged"),
    (lambda f: (f / backup.MANIFEST).write_text((f / backup.MANIFEST).read_text().replace('"documents": 3', '"documents": 4')), "checksum"),
    (lambda f: (f / "extra.txt").write_text("unexpected"), "does not list"),
    (lambda f: rewrite_manifest(f, lambda m: m.update(format_version=999)), "different version"),
    (lambda f: rewrite_manifest(f, lambda m: m.update(schema_revision="9999")), "newer version"),
    (lambda f: rewrite_manifest(f, lambda m: m["files"].append({"path": "../../escape.pdf", "sha256": "0", "bytes": 0})), "never write"),
    (lambda f: rewrite_manifest(f, lambda m: m["counts"].update(documents=4)), "record counts"),
], ids=["changed-original", "missing-original", "garbage-database", "missing-database", "no-manifest", "garbage-manifest", "edited-manifest", "extra-file", "future-format", "future-schema", "path-traversal", "wrong-counts"])
def test_every_kind_of_damage_is_caught_and_nothing_is_restored(data_dir, tmp_path, damage, expected):
    seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    damage(folder)
    check = verify_backup(folder)
    assert not check.ok and any(expected in p for p in check.problems), check.problems
    assert not trial_restore(folder).ok
    with pytest.raises(BackupProblem):
        restore_backup(folder, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()


def test_a_flipped_bit_in_the_database_is_caught(data_dir, tmp_path):
    seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    database = writable(folder / "archive.sqlite3")
    raw = bytearray(database.read_bytes())
    raw[len(raw) // 2] ^= 0xFF
    database.write_bytes(raw)
    assert not verify_backup(folder).ok


def test_broken_relationships_are_caught_even_when_every_hash_matches(data_dir, tmp_path):
    seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    database = writable(folder / "archive.sqlite3")
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("UPDATE import_events SET document_id='nothing' WHERE id=1")
    connection.commit()
    connection.close()
    digest = hashlib.sha256(database.read_bytes()).hexdigest()
    rewrite_manifest(folder, lambda m: m["files"][0].update(sha256=digest, bytes=database.stat().st_size))
    check = verify_backup(folder)
    assert any("relationships" in p for p in check.problems), check.problems


def test_the_active_archive_is_never_overwritten_without_its_name(data_dir, tmp_path):
    client, ids = seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    upload(client, make_pdf("arrived after the backup"), "later.pdf")
    before = (data_dir / "archive.sqlite3").stat().st_mtime_ns
    for wrong in (None, "", "yes", "other"):
        with pytest.raises(BackupProblem, match="nothing was restored"):
            restore_backup(folder, data_dir, wrong)
    assert (data_dir / "archive.sqlite3").stat().st_mtime_ns == before
    assert len(client.get("/api/documents").json()["documents"]) == 4


def test_replacing_moves_the_old_archive_aside_and_keeps_it(data_dir, tmp_path):
    client, ids = seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    upload(client, make_pdf("arrived after the backup"), "later.pdf")
    client.app.state.engine.dispose()
    moved = restore_backup(folder, data_dir, data_dir.name)
    assert moved is not None and (moved / "archive.sqlite3").is_file()
    assert len(list((moved / "originals").rglob("*.pdf"))) == 4
    restored = client_for(data_dir)
    assert len(restored.get("/api/documents").json()["documents"]) == 3


def test_a_running_service_blocks_a_replace(data_dir, tmp_path):
    seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    fd = hold_service_lock(data_dir)
    try:
        with pytest.raises(BackupProblem, match="Stop it"):
            restore_backup(folder, data_dir, data_dir.name)
        with pytest.raises(BackupProblem, match="already using"):
            hold_service_lock(data_dir)
    finally:
        os.close(fd)


def test_a_failed_restore_leaves_the_target_untouched(data_dir, tmp_path, monkeypatch):
    seeded(data_dir)
    folder = make(data_dir, tmp_path).path
    target = tmp_path / "existing"
    target.mkdir()
    (target / "keep.txt").write_text("keep me")
    real = backup._copy_private
    calls = {"n": 0}

    def fails(source, destination):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real(source, destination)

    monkeypatch.setattr(backup, "_copy_private", fails)
    with pytest.raises(OSError):
        restore_backup(folder, target, "existing")
    assert (target / "keep.txt").read_text() == "keep me"
    assert [p.name for p in tmp_path.iterdir() if ".restoring-" in p.name] == []


def test_a_missing_original_is_recorded_and_needs_explicit_acceptance(data_dir, tmp_path):
    client, ids = seeded(data_dir)
    missing = next((data_dir / "originals").rglob("*.pdf"))
    missing.parent.chmod(0o700)
    missing.chmod(0o600)
    missing.unlink()
    result = make(data_dir, tmp_path)
    assert len(result.problems) == 1
    assert any("missing" in p for p in verify_backup(result.path).problems)
    with pytest.raises(BackupProblem):
        restore_backup(result.path, tmp_path / "strict")
    restore_backup(result.path, tmp_path / "accepted", accept_problems=True)
    assert len(list((tmp_path / "accepted" / "originals").rglob("*.pdf"))) == 2


def test_backups_must_stay_outside_git_and_outside_the_archive(data_dir, tmp_path):
    repository = tmp_path / "repo"
    (repository / ".git").mkdir(parents=True)
    with pytest.raises(UnsafeConfiguration, match="Git"):
        validate(Settings(data_dir=data_dir, backups_dir_override=repository / "backups"))
    with pytest.raises(UnsafeConfiguration, match="archive folder"):
        validate(Settings(data_dir=data_dir, backups_dir_override=data_dir / "backups"))
    seeded(data_dir, 1)
    with pytest.raises(BackupProblem, match="Git"):
        create_backup(data_dir / "archive.sqlite3", data_dir / "originals", repository / "backups")
    with pytest.raises(BackupProblem, match="archive folder"):
        create_backup(data_dir / "archive.sqlite3", data_dir / "originals", data_dir / "backups")
    with pytest.raises(BackupProblem, match="Git"):
        restore_backup(make(data_dir, tmp_path).path, repository / "restored")


def run_restore_in_a_terminal(folder: Path, target: Path, typed: bytes) -> subprocess.CompletedProcess:
    """A real terminal on stdin, since the confirmation prompt only appears on one."""
    terminal, stdin = pty.openpty()
    os.write(terminal, typed)
    env = {**os.environ, "THIS_IS_YOU_DATA_DIR": str(target.parent / "unused"), "THIS_IS_YOU_BACKUP_DIR": str(target.parent / "unused backups")}
    try:
        return subprocess.run([sys.executable, "-m", "this_is_you", "restore", str(folder), "--to", str(target)], stdin=stdin, capture_output=True, text=True, env=env, timeout=60)
    finally:
        os.close(stdin)
        os.close(terminal)


def test_the_command_line_needs_the_folders_exact_name_typed(data_dir, tmp_path):
    client, _ = seeded(data_dir, 1)
    folder = make(data_dir, tmp_path).path
    upload(client, make_pdf("arrived after the backup"), "later.pdf")
    client.app.state.engine.dispose()
    refused = run_restore_in_a_terminal(folder, data_dir, b"yes\n")
    assert refused.returncode != 0 and "nothing was restored" in refused.stderr and "Traceback" not in refused.stderr
    assert not list(tmp_path.glob("archive.replaced-*"))
    done = run_restore_in_a_terminal(folder, data_dir, data_dir.name.encode() + b"\n")
    assert done.returncode == 0, done.stderr
    moved = list(tmp_path.glob("archive.replaced-*"))
    assert len(moved) == 1 and "kept at" in done.stdout
    assert len(list((moved[0] / "originals").rglob("*.pdf"))) == 2
    assert len(list((data_dir / "originals").rglob("*.pdf"))) == 1


def test_the_api_runs_one_job_at_a_time_and_checks_by_name_only(data_dir, tmp_path):
    client = client_for(data_dir, backups_dir_override=tmp_path / "backups")
    upload(client, make_pdf("one"))
    assert client.post("/api/backups").status_code == 403  # Other websites cannot start one.
    client.post("/api/backups", headers=CLIENT_HEADERS)
    client.app.state.backups.wait()
    name = client.get("/api/backups").json()["backups"][0]["name"]
    assert client.post("/api/backups/..%2F..%2Fetc/check", headers=CLIENT_HEADERS).status_code in (404, 405)
    assert client.post("/api/backups/not-a-backup/check", headers=CLIENT_HEADERS).status_code == 404
    assert client.post(f"/api/backups/{name}/check", headers=CLIENT_HEADERS).status_code == 202
    client.app.state.backups.wait()
    assert client.get("/api/backups").json()["last_result"]["ok"] is True
    assert verify_backup(tmp_path / "backups" / name).ok  # Recording a check does not spoil the backup.
