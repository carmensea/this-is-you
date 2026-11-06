"""The check that keeps records, backups and secrets out of Git, tried in a throwaway repository with fictional files."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CHECK = REPO / "tools" / "check-no-records.py"


def _git(where: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(where), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args], capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    (tmp_path / "ok.py").write_text("print('fictional')\n")
    return tmp_path


def _check(where: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(CHECK), *args], cwd=where, capture_output=True, text=True)


def _staged(repo: Path, name: str, body: bytes) -> subprocess.CompletedProcess:
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    _git(repo, "add", "-f", name)
    return _check(repo)


def test_ordinary_source_passes(repo):
    assert _staged(repo, "ok.py", b"print('fictional')\n").returncode == 0


@pytest.mark.parametrize("name", [
    "report.pdf", "REPORT.PDF", "records/lab.pdf", "archive.sqlite3", "archive.sqlite3-wal", "archive.sqlite3-shm",
    "archive.sqlite3.before-upgrade-20260101T000000", "x.db", "this-is-you-backup-20260101T000000Z.tiyb",
    "this-is-you-backup-20260101T000000Z.tiyb.incomplete", "this-is-you-backup-20260101T000000Z/manifest.json",
    "backup-key.json", ".env", ".env.production", "deploy/.env", "server.pem", "tls.key", "secrets/ts_authkey", "ts_authkey",
    "originals/ab/cd/x.txt", "set-aside/notes.txt", "ThisIsYou.replaced-20260101T000000Z/notes.txt", "scan.heic", "chart.dcm",
    # A browser capture holds cookies and tokens; a bulk export holds records; connector credentials live in a folder of their own.
    "session.har", "export/Observation.ndjson", "client-id", ".this-is-you-epic-sandbox-keys/notes.txt",
])
def test_names_that_look_like_records_or_secrets_are_refused_even_when_forced(repo, name):
    answer = _staged(repo, name, b"fictional")
    assert answer.returncode == 1 and name in answer.stderr


@pytest.mark.parametrize("body", [b"%PDF-1.7 fictional", b"SQLite format 3\0 fictional", b"TIYBACKUP2\n fictional", b"binary\0fictional"])
def test_contents_are_caught_under_an_innocent_name(repo, body):
    assert _staged(repo, "notes.txt", body).returncode == 1


# Built at run time, so this test file holds nothing that looks like a real secret.
@pytest.mark.parametrize("body", ["eyJ" + "a" * 20 + ".eyJ" + "b" * 20 + "." + "c" * 20, "-----BEGIN " + "OPENSSH PRIVATE KEY-----", "ghp_" + "a" * 36, "tskey-" + "auth-fictional123", "sk-ant-" + "a" * 40, "AKIA" + "A" * 16])
def test_secrets_inside_a_source_file_are_caught_and_not_printed(repo, body):
    answer = _staged(repo, "config.py", f"VALUE = '{body}'\n".encode())
    assert answer.returncode == 1 and body not in answer.stderr + answer.stdout


def test_a_large_file_is_refused(repo):
    assert _staged(repo, "big.txt", b"a" * (5 * 1024 * 1024 + 1)).returncode == 1


def test_history_is_checked_even_after_the_file_is_deleted(repo):
    (repo / "report.pdf").write_bytes(b"fictional")
    _git(repo, "add", "-f", "report.pdf")
    _git(repo, "commit", "-qm", "oops", "--no-verify")
    _git(repo, "rm", "-q", "report.pdf")
    _git(repo, "commit", "-qm", "removed", "--no-verify")
    assert _check(repo).returncode == 0  # Nothing is staged now.
    answer = _check(repo, "--history")
    assert answer.returncode == 1 and "report.pdf" in answer.stderr


def test_this_repository_s_tracked_files_pass():
    files = _git(REPO, "ls-files", "-z").stdout.split("\0")
    from importlib.util import module_from_spec, spec_from_file_location

    spec = spec_from_file_location("check_no_records", CHECK)
    check = module_from_spec(spec)
    spec.loader.exec_module(check)
    assert [name for name in files if name and (REPO / name).is_file() and check.problem_with(name, (REPO / name).read_bytes())] == []


def test_git_ignores_what_could_hold_records():
    names = ["a.pdf", "x/a.PDF", "archive.sqlite3-wal", "archive.sqlite3.before-upgrade-1", "a.tiyb", "a.tiyb.check.json", "this-is-you-backup-1/manifest.json", "backup-key.json", ".env", "deploy/.env", "secrets/ts_authkey", "originals/a", "set-aside/a", "x.pem", "x.key", "service.lock"]
    ignored = subprocess.run(["git", "-C", str(REPO), "check-ignore", "--no-index", *names], capture_output=True, text=True).stdout.split("\n")
    assert sorted(n for n in names if n not in ignored) == []


@pytest.mark.parametrize("name", ["docs/jwks-example.json", "tools/perf/baselines/after.json", "src/data/notes.md"])
def test_ordinary_json_and_docs_still_pass(repo, name):
    assert _staged(repo, name, b'{"keys": [{"kty": "RSA", "n": "fictional", "e": "AQAB"}]}').returncode == 0
