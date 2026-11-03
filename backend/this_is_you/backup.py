"""Backups you can trust because they were checked, and restores that cannot damage what is already there.

A backup is a folder: a consistent copy of the database, the original files, and a manifest of hashes. It is
built under a temporary name and only takes its final name once complete, so an interrupted run can never be
mistaken for a backup. Backups are read as untrusted input: nothing in a manifest is believed without checking.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from alembic.script import ScriptDirectory

from .backup_crypto import EXTENSION, BackupKey, CannotOpen, load_key, open_into, seal_folder
from .config import Settings, enclosing_git_repository
from .db import _config

log = logging.getLogger("this_is_you.backup")  # Counts and outcomes only. Never file names or contents.

FORMAT_VERSION = 1
MANIFEST = "manifest.json"
DATABASE = "archive.sqlite3"
LAST_CHECK = "last-check.json"  # Written after a check. Not part of the backup's contents.
INCOMPLETE_SUFFIX = ".incomplete"
CHECK_SUFFIX = ".check.json"  # Beside an encrypted backup, which cannot hold it.
LOCK_FILE = "service.lock"
_NAME = re.compile(r"this-is-you-backup-\d{8}T\d{6}Z(-\d+)?")
_ORIGINAL = re.compile(r"originals/([0-9a-f]{2})/([0-9a-f]{2})/\1\2[0-9a-f]{60}\.pdf")
# Sign-in details stay out of every backup. Reused passphrases should not be crackable from a lost drive,
# and a restored archive is signed in to again with a passphrase set on that machine.
_NOT_BACKED_UP = ("auth_credential", "auth_sessions")
KEEP_BEFORE_UPGRADE = 2
_COUNTED = ("documents", "import_events", "extraction_runs", "metadata_proposals", "metadata_decisions", "lab_observations", "lab_observation_revisions", "import_batches", "import_items", "identity_profile")
_CHUNK = 1024 * 1024


class BackupProblem(Exception):
    """Something a person needs to know, in words that are safe to show."""


def _now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _hash_file(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _sync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _copy_private(source: Path, target: Path) -> tuple[str, int]:
    """Copies while hashing what was read, and flushes it to disk. Returns the hash of the bytes copied."""
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest, size = hashlib.sha256(), 0
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with source.open("rb") as src, os.fdopen(fd, "wb") as out:
        while chunk := src.read(_CHUNK):
            digest.update(chunk)
            size += len(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    target.chmod(0o400)
    return digest.hexdigest(), size


def _manifest_hash(manifest: dict) -> str:
    body = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _open_readonly(path: Path) -> sqlite3.Connection:
    # immutable: never creates -wal or -shm beside a backup. trusted_schema off: a tampered file's schema gets no code paths.
    connection = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    connection.execute("PRAGMA trusted_schema=OFF")
    return connection


def _counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return {t: connection.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in _COUNTED if t in tables}


def _schema_revision(connection: sqlite3.Connection) -> str:
    return connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def _snapshot_database(source: Path, target: Path) -> None:
    """A point-in-time copy, however busy the source. Readers and writers carry on while it runs."""
    os.close(os.open(target, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600))
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)  # The online backup API includes everything committed to the WAL.
        dst.execute("PRAGMA journal_mode=DELETE")  # One self-contained file, with no -wal to lose.
        dst.execute("PRAGMA secure_delete=ON")
        present = {r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in _NOT_BACKED_UP:
            if table in present:
                dst.execute(f'DELETE FROM "{table}"')
        dst.commit()
    finally:
        dst.close()
        src.close()
    with target.open("rb+") as f:
        os.fsync(f.fileno())


@dataclass
class BackupResult:
    path: Path
    documents: int
    bytes: int
    problems: list[str]


def require_destination(destination: Path) -> None:
    """A drive that is not connected must not turn into a new folder on this one, holding a backup nobody expects there."""
    if not destination.expanduser().parent.is_dir():
        raise BackupProblem(f"{destination.parent} does not exist. If it is on another drive, check that the drive is connected.")


DRIVE_MARKER = ".this-is-you-backups"


def require_drive(settings: Settings, destination: Path) -> None:
    """In production the default folder is a mount point, which still exists with nothing plugged in. Writing there would fill the system disk with what looks like a safe copy."""
    if settings.production and not (destination / DRIVE_MARKER).exists():
        raise BackupProblem("The backup drive is not connected, or has not been prepared. Nothing was written. See docs/deployment.md.")


def on_same_drive(destination: Path, data_dir: Path) -> bool:
    """Whether losing this drive would lose both. A folder not created yet counts as where it would be created."""
    path = destination.expanduser().resolve()
    while not path.exists() and path != path.parent:
        path = path.parent
    return path.stat().st_dev == data_dir.stat().st_dev


def create_backup(database: Path, originals: Path, destination: Path, on_progress=lambda done, total: None, staging: bool = False) -> BackupResult:
    """Builds a complete backup folder inside `destination`. Originals are chosen from the snapshot, so they always match it."""
    if enclosing_git_repository(destination) is not None:
        raise BackupProblem("Backups cannot be kept inside a Git repository. Choose a folder outside it.")
    if not staging and destination.resolve().is_relative_to(originals.parent.resolve()):
        raise BackupProblem("Backups cannot be kept inside the archive folder. Choose a folder outside it.")
    if not database.is_file():
        raise BackupProblem("There is no archive here to back up.")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    final = destination / f"this-is-you-backup-{_now_stamp()}"
    for n in range(1, 1000):
        if not final.exists():
            break
        final = destination / f"this-is-you-backup-{_now_stamp()}-{n}"
    work = final.with_name(final.name + INCOMPLETE_SUFFIX)
    work.mkdir(mode=0o700)
    try:
        _snapshot_database(database, work / DATABASE)
        connection = _open_readonly(work / DATABASE)
        try:
            documents = connection.execute("SELECT storage_key, sha256 FROM documents ORDER BY storage_key").fetchall()
            counts, revision = _counts(connection), _schema_revision(connection)
        finally:
            connection.close()
        database_hash, database_size = _hash_file(work / DATABASE)
        files = [{"path": DATABASE, "sha256": database_hash, "bytes": database_size}]
        problems: list[str] = []
        total = len(documents)
        needed = sum((originals / key).stat().st_size for key, _ in documents if (originals / key).is_file())
        if shutil.disk_usage(destination).free < needed:
            raise BackupProblem("There is not enough free space for this backup. Nothing usable was written.")
        for done, (key, expected) in enumerate(documents, 1):
            source = originals / key
            if not source.is_file():
                problems.append(f"An original file is missing from the archive: {expected[:12]}.")
                continue
            target = work / "originals" / key
            digest, size = _copy_private(source, target)
            files.append({"path": f"originals/{key}", "sha256": digest, "bytes": size})
            if digest != expected:
                problems.append(f"An original file no longer matches its recorded hash: {expected[:12]}.")
            on_progress(done, total)
        manifest = {
            "format_version": FORMAT_VERSION, "app": "this-is-you", "schema_revision": revision, "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": counts, "problems": problems, "files": files,
        }
        manifest["manifest_sha256"] = _manifest_hash(manifest)
        fd = os.open(work / MANIFEST, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(manifest, out, indent=1)
            out.flush()
            os.fsync(out.fileno())
        for directory in {work, *(p for p in work.rglob("*") if p.is_dir())}:
            _sync_dir(directory)
        os.rename(work, final)  # The only moment it becomes a backup.
        _sync_dir(destination)
    except BaseException:
        _remove_tree(work)
        raise
    log.info("backup written: %d documents, %d problems", total, len(problems))
    return BackupResult(final, total, sum(f["bytes"] for f in files), problems)


def _remove_tree(path: Path) -> None:
    # Originals are read-only, so their folders have to allow removal first.
    if not path.exists():
        return
    for directory, _subdirs, names in os.walk(path):
        os.chmod(directory, 0o700)
        for name in names:
            os.chmod(os.path.join(directory, name), 0o600)
    shutil.rmtree(path)


@dataclass
class Check:
    ok: bool
    problems: list[str] = field(default_factory=list)
    manifest: dict | None = None


def _known_revision(revision: str) -> bool:
    try:
        return ScriptDirectory.from_config(_config()).get_revision(revision) is not None
    except Exception:
        return False


def _check_database(path: Path, expected_counts: dict | None) -> tuple[list[str], list[tuple[str, str]]]:
    """Structure, relationships, and the list of originals it expects. Reads only."""
    problems: list[str] = []
    documents: list[tuple[str, str]] = []
    try:
        connection = _open_readonly(path)
    except sqlite3.Error:
        return ["The database copy cannot be opened."], documents
    try:
        result = connection.execute("PRAGMA integrity_check(1)").fetchone()[0]
        if result != "ok":
            return ["The database copy is damaged."], documents
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            problems.append("The database copy has broken relationships between records.")
        counts = _counts(connection)
        if expected_counts is not None and counts != expected_counts:
            problems.append("The database copy does not hold the record counts the manifest lists.")
        documents = [(str(k), str(s)) for k, s in connection.execute("SELECT storage_key, sha256 FROM documents")]
    except sqlite3.Error:
        problems.append("The database copy is damaged.")
    finally:
        connection.close()
    return problems, documents


def create_encrypted_backup(settings: Settings, destination: Path, key: BackupKey, on_progress=lambda done, total: None) -> BackupResult:
    """Seals a checked backup into one file on `destination`, which never sees a plain copy, even after a crash.

    shortcut: the plain copy is built in the archive's own folder first, so a backup needs room for the archive again there. Stream the originals straight into the seal if that ever matters.
    """
    if enclosing_git_repository(destination) is not None:
        raise BackupProblem("Backups cannot be kept inside a Git repository. Choose a folder outside it.")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = settings.staging_dir
    _remove_tree(staging)
    staging.mkdir(mode=0o700)
    work: Path | None = None
    try:
        result = create_backup(settings.database_path, settings.originals_dir, staging, on_progress, staging=True)
        check = verify_backup(result.path)
        if not check.ok:
            raise BackupProblem("This backup failed its check, so it was not sealed. " + " ".join(check.problems))
        final = destination / (result.path.name + EXTENSION)
        work = final.with_name(final.name + INCOMPLETE_SUFFIX)
        file_key = seal_folder(result.path, work, key)
        # Opened with this file's own key, gone when this returns. The passphrase is not here, and is not needed for this test.
        trial = staging / "trial"
        try:
            open_into(work, trial, None, file_key)
        except CannotOpen:
            raise BackupProblem("The sealed copy could not be opened again, so it was not kept.") from None
        if not (check := verify_backup(trial)).ok:
            raise BackupProblem("The sealed copy did not pass its check, so it was not kept. " + " ".join(check.problems))
        os.rename(work, final)
        work = None
        _sync_dir(destination)
    finally:
        if work is not None:
            work.unlink(missing_ok=True)
        _remove_tree(staging)
    return BackupResult(final, result.documents, final.stat().st_size, result.problems)


def _open_sealed(sealed: Path, work: Path, passphrase: str) -> None:
    try:
        open_into(sealed, work, passphrase)
    except CannotOpen:
        _remove_tree(work)
        raise BackupProblem("This backup could not be opened. The passphrase is wrong, or the file was damaged or changed. Nothing was restored.") from None
    except BaseException:
        _remove_tree(work)
        raise


def verify_sealed(sealed: Path, staging: Path, passphrase: str) -> Check:
    """Opens it in the archive's private folder, which is never the backup drive, and checks everything. Keeps nothing."""
    _remove_tree(staging)
    staging.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging.mkdir(mode=0o700)
    try:
        _open_sealed(sealed, staging / "opened", passphrase)
        return verify_backup(staging / "opened")
    except BackupProblem as problem:
        return Check(False, [str(problem)])
    finally:
        _remove_tree(staging)


def restore_sealed(sealed: Path, target: Path, passphrase: str, replace_confirmation: str | None = None, accept_problems: bool = False) -> Path | None:
    target = target.expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Beside the target, which is about to hold the same plain files anyway. Cleared on the next restore there.
    opened = target.with_name(f".{target.name}.restoring-opened-{os.getpid()}")
    _open_sealed(sealed, opened, passphrase)
    try:
        return restore_backup(opened, target, replace_confirmation, accept_problems)
    finally:
        _remove_tree(opened)


def verify_backup(folder: Path) -> Check:
    """Every byte and relationship, against a manifest that also has to prove itself. Changes nothing."""
    if folder.name.endswith(INCOMPLETE_SUFFIX):
        return Check(False, ["This backup did not finish, so it cannot be used."])
    if folder.is_symlink() or not folder.is_dir():
        return Check(False, ["This is not a backup folder."])
    if not (folder / MANIFEST).is_file():
        return Check(False, ["This backup has no manifest, so it cannot be trusted."])
    try:
        manifest = json.loads((folder / MANIFEST).read_text())
        if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
            raise ValueError
    except (ValueError, OSError, UnicodeDecodeError):
        return Check(False, ["The manifest is damaged."])
    if manifest.get("manifest_sha256") != _manifest_hash(manifest):
        return Check(False, ["The manifest is damaged: its own checksum does not match."])
    if manifest.get("format_version") != FORMAT_VERSION or manifest.get("app") != "this-is-you":
        return Check(False, ["This backup was made by a different version of This Is You, and this version cannot read it."], manifest)
    if not _known_revision(str(manifest.get("schema_revision"))):
        return Check(False, ["This backup was made by a newer version of This Is You. Update the app first."], manifest)

    problems = [f"Recorded when the backup was made: {p}" for p in manifest.get("problems", [])]
    listed: dict[str, dict] = {}
    for entry in manifest["files"]:
        path = entry.get("path") if isinstance(entry, dict) else None
        # Only the two shapes this app writes. A manifest cannot point outside the folder.
        if path != DATABASE and not (isinstance(path, str) and _ORIGINAL.fullmatch(path)):
            return Check(False, ["The manifest lists a path that this app would never write."], manifest)
        listed[path] = entry
    if DATABASE not in listed:
        return Check(False, ["The manifest does not list the database."], manifest)
    for path, entry in listed.items():
        file = folder / path
        if file.is_symlink() or not file.is_file():
            problems.append("A file the manifest lists is missing from the backup.")
            continue
        digest, size = _hash_file(file)
        if digest != entry.get("sha256") or size != entry.get("bytes"):
            problems.append("A file in the backup does not match its recorded hash.")
    on_disk = {p.relative_to(folder).as_posix() for p in folder.rglob("*") if not p.is_dir()}
    if on_disk - set(listed) - {MANIFEST, LAST_CHECK}:
        problems.append("The backup holds files the manifest does not list.")
    database_problems, documents = _check_database(folder / DATABASE, manifest.get("counts"))
    problems += database_problems
    # What the backup recorded when it was made explains these, and has already been listed above.
    for key, expected in documents if not manifest.get("problems") else []:
        entry = listed.get(f"originals/{key}")
        if entry is None:
            problems.append("A document's original file is not in the backup.")
        elif entry.get("sha256") != expected:
            problems.append("A document's original does not match the hash its record holds.")
    # Many files can share one problem. Say each kind once.
    problems = list(dict.fromkeys(problems))
    return Check(not problems, problems, manifest)


def check_archive(data_dir: Path) -> list[str]:
    """Whether a restored folder is whole: database, relationships, and every original's bytes."""
    problems, documents = _check_database(data_dir / DATABASE, None)
    for key, expected in documents:
        file = data_dir / "originals" / key
        if not file.is_file():
            problems.append("A restored document has no original file.")
        elif _hash_file(file)[0] != expected:
            problems.append("A restored original does not match the hash its record holds.")
    return list(dict.fromkeys(problems))


def _restore_into(folder: Path, manifest: dict, work: Path, accept_problems: bool) -> None:
    work.mkdir(mode=0o700)
    for entry in manifest["files"]:
        digest, _ = _copy_private(folder / entry["path"], work / entry["path"])
        if digest != entry["sha256"]:
            raise BackupProblem("A file changed while it was being restored. Nothing was replaced.")
    (work / DATABASE).chmod(0o600)  # A working database, unlike the backup's copy.
    (work / "originals").mkdir(exist_ok=True, mode=0o700)
    problems = check_archive(work)
    if problems and not accept_problems:
        raise BackupProblem(" ".join(problems))
    for directory in {work, *(p for p in work.rglob("*") if p.is_dir())}:
        _sync_dir(directory)


def _service_running(data_dir: Path) -> bool:
    lock = data_dir / LOCK_FILE
    if not lock.exists():
        return False
    fd = os.open(lock, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return True
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)


def hold_service_lock(data_dir: Path) -> int:
    """Taken by a running service. Refuses a second service on one archive, and tells a restore to wait."""
    fd = os.open(data_dir / LOCK_FILE, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise BackupProblem("Another This Is You service is already using this archive folder.") from None
    return fd


def restore_backup(folder: Path, target: Path, replace_confirmation: str | None = None, accept_problems: bool = False) -> Path | None:
    """Restores to `target`. Returns where a replaced archive was moved, if there was one.

    A folder that already holds anything is replaced only when `replace_confirmation` repeats its name, and it
    is moved aside rather than deleted. The new copy is complete and checked before anything is touched.
    """
    target = target.expanduser().resolve()
    if enclosing_git_repository(target) is not None:
        raise BackupProblem("An archive cannot be restored inside a Git repository.")
    check = verify_backup(folder)
    if not check.ok and not (accept_problems and check.manifest and all(p.startswith("Recorded when") for p in check.problems)):
        raise BackupProblem("This backup failed its check, so nothing was restored. " + " ".join(check.problems))
    occupied = target.exists() and any(target.iterdir())
    if occupied:
        if replace_confirmation != target.name:
            raise BackupProblem(f'"{target.name}" already holds files, so nothing was restored. To replace it, repeat its exact name as the confirmation.')
        if _service_running(target):
            raise BackupProblem("The service is using this archive. Stop it, then restore.")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Plain copies left by a crash in an earlier restore here. The one this call may be reading from is kept.
    for leftover in target.parent.glob(f".{target.name}.restoring-*"):
        if leftover.resolve() != folder.resolve():
            _remove_tree(leftover)
    work = Path(tempfile.mkdtemp(dir=target.parent, prefix=f".{target.name}.restoring-"))
    work.rmdir()
    try:
        _restore_into(folder, check.manifest or {}, work, accept_problems)
        moved = None
        if target.exists():
            if occupied:
                moved = target.with_name(f"{target.name}.replaced-{_now_stamp()}")
                os.rename(target, moved)  # Kept, in case this was the wrong backup.
            else:
                target.rmdir()
        os.rename(work, target)
        _sync_dir(target.parent)
    except BaseException:
        _remove_tree(work)
        raise
    return moved


def trial_restore(folder: Path) -> Check:
    """Restores into a temporary folder beside the backup, checks it, and removes it. The active archive is not involved."""
    check = verify_backup(folder)
    if not check.ok:
        return check
    scratch = Path(tempfile.mkdtemp(dir=folder.parent, prefix=".restore-test-"))
    try:
        restore_backup(folder, scratch / "archive")
    except BackupProblem as problem:
        return Check(False, [str(problem)], check.manifest)
    finally:
        _remove_tree(scratch)
    return check


# ---- The jobs behind the API. One at a time, in the background.

def _check_file(path: Path) -> Path:
    return path / LAST_CHECK if path.is_dir() else path.with_name(path.name + CHECK_SUFFIX)


def _record_check(path: Path, check: Check) -> None:
    payload = {"checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ok": check.ok, "problems": check.problems}
    target = _check_file(path)
    temp = target.with_name(target.name + ".tmp")
    temp.unlink(missing_ok=True)
    fd = os.open(temp, os.O_CREAT | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(payload, out)
    os.replace(temp, target)


def _last_check(path: Path) -> dict | None:
    try:
        return json.loads(_check_file(path).read_text())
    except (OSError, ValueError):
        return None


def describe(folder: Path) -> dict:
    """A quick look for the list. It reads the manifest and last check, and proves nothing by itself."""
    if folder.name.endswith(INCOMPLETE_SUFFIX):
        return {"name": folder.name, "state": "incomplete", "created_at": None, "documents": None, "bytes": None, "last_check": None}
    if folder.is_file():
        return {"name": folder.name, "state": "encrypted", "created_at": None, "documents": None, "bytes": folder.stat().st_size, "last_check": _last_check(folder)}
    try:
        manifest = json.loads((folder / MANIFEST).read_text())
        files, counts = manifest["files"], manifest["counts"]
        info = {"state": "complete", "created_at": manifest.get("created_at"), "documents": counts.get("documents"), "bytes": sum(f["bytes"] for f in files)}
    except (OSError, ValueError, KeyError, TypeError):
        info = {"state": "damaged", "created_at": None, "documents": None, "bytes": None}
    return {"name": folder.name, **info, "last_check": _last_check(folder)}


def _is_backup(path: Path) -> bool:
    name = path.name.removesuffix(INCOMPLETE_SUFFIX)
    if name.endswith(EXTENSION):
        return path.is_file() and not path.is_symlink() and _NAME.fullmatch(name.removesuffix(EXTENSION)) is not None
    return path.is_dir() and not path.is_symlink() and _NAME.fullmatch(name) is not None


def clear_leftovers(settings: Settings) -> None:
    """At start, when nothing can be using them: plain copies a crash left behind, and old pre-upgrade databases."""
    _remove_tree(settings.staging_dir)
    if settings.backups_dir.is_dir():
        for leftover in settings.backups_dir.glob(".restore-test-*"):
            _remove_tree(leftover)
    # The newest are kept for going back. Older ones are only more copies of old records.
    copies = sorted(settings.data_dir.glob(f"{DATABASE}.before-upgrade-*"), reverse=True)
    for stale in copies[KEEP_BEFORE_UPGRADE:]:
        stale.unlink(missing_ok=True)


@dataclass(frozen=True)
class PruneItem:
    path: Path
    why: str


def plan_prune(settings: Settings, keep: int, include_replaced: bool) -> list[PruneItem]:
    """What `prune` would remove. Unfinished work, backups past the newest `keep`, and replaced archives if asked.

    The newest backup whose last check passed always stays.
    """
    root = settings.backups_dir
    plan: list[PruneItem] = []
    if root.is_dir():
        backups = sorted((p for p in root.iterdir() if _is_backup(p)), key=lambda p: p.name, reverse=True)
        finished = [p for p in backups if not p.name.endswith(INCOMPLETE_SUFFIX)]
        plan += [PruneItem(p, "did not finish") for p in backups if p.name.endswith(INCOMPLETE_SUFFIX)]
        plan += [PruneItem(p, "failed test restore") for p in root.glob(".restore-test-*")]
        good = next((p for p in finished if (describe(p).get("last_check") or {}).get("ok")), None)
        plan += [PruneItem(p, "older backup") for p in finished[keep:] if p != good]
    if include_replaced:
        plan += [PruneItem(p, "replaced archive") for p in sorted(settings.data_dir.parent.glob(f"{settings.data_dir.name}.replaced-*"))]
    return plan


def _remove(path: Path) -> None:
    if path.is_dir():
        _remove_tree(path)
    else:
        path.unlink(missing_ok=True)
        path.with_name(path.name + CHECK_SUFFIX).unlink(missing_ok=True)


def apply_prune(plan: list[PruneItem]) -> None:
    for item in plan:
        _remove(item.path)


class BackupJobs:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self.current: dict | None = None
        self.last: dict | None = None

    def list(self) -> list[dict]:
        root = self.settings.backups_dir
        if not root.is_dir():
            return []
        # While a backup runs, its own unfinished folder is not a leftover.
        writing = self.current is not None and self.current["kind"] == "backup"
        found = [p for p in root.iterdir() if _is_backup(p) and not (writing and p.name.endswith(INCOMPLETE_SUFFIX))]
        return [describe(p) for p in sorted(found, key=lambda p: p.name, reverse=True)]

    def folder(self, name: str) -> Path:
        path = self.settings.backups_dir / name
        if name.endswith(INCOMPLETE_SUFFIX) or "/" in name or not _is_backup(path):
            raise KeyError(name)
        return path

    @property
    def key(self) -> BackupKey | None:
        return load_key(self.settings.backup_key_path)

    def _start(self, job: dict, work) -> bool:
        with self._lock:
            if self.current is not None:
                return False
            self.current = job

        def run() -> None:
            outcome = {"kind": job["kind"], "name": job.get("name"), "ok": False, "problems": []}
            try:
                outcome.update(work())
            except BackupProblem as problem:
                outcome["problems"] = [str(problem)]
            except OSError:
                outcome["problems"] = ["The backup could not be written. Check that the drive is connected and has free space. No partial backup was kept."]
            except Exception as problem:
                log.error("backup job failed with %s", type(problem).__name__)
                outcome["problems"] = ["This did not finish because of an unexpected error. No partial backup was kept."]
            with self._lock:
                self.last, self.current = outcome, None

        threading.Thread(target=run, daemon=True, name="backup").start()
        return True

    def start_backup(self) -> bool:
        def progress(done: int, total: int) -> None:
            if self.current:
                self.current.update(done=done, total=total)

        def work() -> dict:
            root = self.settings.backups_dir
            require_destination(root)
            require_drive(self.settings, root)
            root.mkdir(exist_ok=True, mode=0o700)
            # Only this job writes here, and it is not running yet, so these are leftovers from a crash.
            for leftover in root.iterdir():
                if leftover.name.endswith(INCOMPLETE_SUFFIX) and _is_backup(leftover):
                    _remove(leftover)
            key = self.key
            if key is None:
                raise BackupProblem("Set a backup passphrase first: npm run backend -- backup-key set. Nothing was written.")
            result = create_encrypted_backup(self.settings, root, key, progress)
            check = Check(not result.problems, result.problems)
            _record_check(result.path, check)
            return {"name": result.path.name, "ok": check.ok, "problems": check.problems}

        return self._start({"kind": "backup", "done": 0, "total": 0}, work)

    def start_check(self, name: str, passphrase: str | None = None) -> bool:
        folder = self.folder(name)

        def work() -> dict:
            check = verify_sealed(folder, self.settings.staging_dir, passphrase or "") if folder.is_file() else trial_restore(folder)
            _record_check(folder, check)
            return {"ok": check.ok, "problems": check.problems}

        return self._start({"kind": "check", "name": name, "done": 0, "total": 0}, work)

    def wait(self) -> None:
        """For tests."""
        while self.current is not None:
            time.sleep(0.01)
