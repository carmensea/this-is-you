#!/usr/bin/env python3
"""Refuses to let records, archives, backups or secrets into Git. Run by .githooks on every commit and push.

  tools/check-no-records.py          what is staged for commit
  tools/check-no-records.py --history  every file in every commit of every branch

A second line of defense: the archive already lives outside this repository, and the service refuses to store documents
in one. `git commit --no-verify` can skip this, so it stops accidents, not someone determined. Nothing it finds is printed
beyond the file's name and which rule it broke, so a secret does not end up in a terminal log.
"""
from __future__ import annotations

import re
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024

FORBIDDEN_PATH = re.compile(
    r"(?i)"
    r"\.(pdf|sqlite\d?|sqlite\d?-(wal|shm|journal)|db|db-(wal|shm)|tiyb|pem|key|p12|pfx|jks|kdbx|gpg|dump|bak|heic|tiff?|dcm|hl7|ccda?|docx?|xlsx?|zip|7z|tgz)$"
    r"|\.tiyb\."
    r"|(^|/)\.env($|\.)"
    r"|(^|/)(secrets?|credentials?|set-aside|originals|incoming|backup-staging)(/|$)"
    r"|(^|/)this-is-you-backup-"
    r"|\.sqlite\d?\."
    r"|\.replaced-"
    r"|(^|/)(ts_authkey|backup-key\.json|service\.lock|id_rsa|id_ed25519|client-id)$"
    # A browser capture holds cookies and tokens, a bulk export holds records, and connector credentials keep a folder of their own.
    r"|\.(har|ndjson)$"
    r"|(^|/)\.this-is-you-[^/]*keys(/|$)"
)
FORBIDDEN_START = {b"%PDF-": "a PDF", b"SQLite format 3": "a database", b"TIYBACKUP": "an encrypted backup"}
SECRETS = {
    "a private key": re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY"),
    "an access or session token": re.compile(rb"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "a GitHub token": re.compile(rb"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"),
    "a Tailscale key": re.compile(rb"\btskey-[a-zA-Z0-9-]{10,}"),
    "an API key": re.compile(rb"\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}"),
}
FONT = re.compile(r"\.(woff2?|ttf|otf)$", re.I)


def _git(*args: str, repo: str | None = None) -> bytes:
    return subprocess.run(["git", *(["-C", repo] if repo else []), *args], capture_output=True, check=True).stdout


def problem_with(path: str, data: bytes) -> str | None:
    if FORBIDDEN_PATH.search(path):
        return "its name looks like a record, archive, backup or secret"
    for start, what in FORBIDDEN_START.items():
        if data.startswith(start):
            return f"it is {what}"
    if len(data) > MAX_BYTES:
        return f"it is larger than {MAX_BYTES // (1024 * 1024)} MB"
    if b"\0" in data[:8192] and not FONT.search(path):
        return "it is a binary file"
    for what, rule in SECRETS.items():
        if rule.search(data):
            return f"it holds what looks like {what}"
    return None


def staged() -> list[tuple[str, bytes]]:
    names = _git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").decode(errors="replace").split("\0")
    return [(name, _git("show", f":{name}")) for name in names if name]


def history() -> list[tuple[str, bytes]]:
    found: dict[str, str] = {}
    for line in _git("rev-list", "--all", "--objects").decode(errors="replace").splitlines():
        sha, _, path = line.partition(" ")
        if path:
            found.setdefault(sha, path)
    kinds = subprocess.run(["git", "cat-file", "--batch-check=%(objectname) %(objecttype)"], input="\n".join(found).encode(), capture_output=True, check=True).stdout.decode()
    blobs = [line.split()[0] for line in kinds.splitlines() if line.split()[1] == "blob"]
    return [(found[sha], _git("cat-file", "blob", sha)) for sha in blobs]


def main() -> int:
    files = history() if "--history" in sys.argv else staged()
    refused = sorted({(path, why) for path, data in files if (why := problem_with(path, data))})
    for path, why in refused:
        print(f"Refused: {path}: {why}.", file=sys.stderr)
    if refused:
        print("Records, archives, backups and secrets stay out of Git. Nothing was committed or pushed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
