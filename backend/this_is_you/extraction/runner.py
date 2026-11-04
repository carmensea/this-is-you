"""Starts the reader process, enforces its limits from outside, and checks everything it sends back."""
from __future__ import annotations

import json
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import BinaryIO

from .reader_service import TIMED_OUT, client_exchange
from .sandbox import reader_socket, wrap
from .worker import EXIT_MEMORY

_STATUSES = {"extracted", "partial", "image_only", "encrypted", "no_text", "failed", "too_complex"}
_FIELDS = {"document_type", "service_date", "provider", "report_title"}
_CONFIDENCE = {"high", "medium", "low"}
_MAX_OUTPUT = 2 * 1024 * 1024


@dataclass(frozen=True)
class Limits:
    wall_seconds: float = 45
    cpu_seconds: int = 30
    memory_bytes: int = 1024 * 1024 * 1024
    max_pages: int = 30
    max_chars: int = 400_000


@dataclass
class ExtractionResult:
    status: str
    page_count: int | None = None
    pages_read: int = 0
    pages_with_text: int = 0
    pages_failed: int = 0
    truncated: bool = False
    text_sha256: str | None = None
    proposals: list[dict] = field(default_factory=list)
    lab_rows: list[dict] = field(default_factory=list)
    patient: dict | None = None


def _clean_proposal(raw: dict) -> dict | None:
    if not isinstance(raw, dict) or raw.get("field") not in _FIELDS or raw.get("confidence") not in _CONFIDENCE:
        return None
    if not isinstance(raw.get("value"), str) or not raw["value"] or not isinstance(raw.get("page"), int):
        return None
    return {"field": raw["field"], "value": raw["value"][:255], "confidence": raw["confidence"], "reason": str(raw.get("reason", ""))[:300], "page": raw["page"], "snippet": str(raw.get("snippet", ""))[:200]}


def _text(raw: object, limit: int) -> str | None:
    return raw[:limit] if isinstance(raw, str) and raw else None


def _clean_lab_row(raw: dict) -> dict | None:
    if not isinstance(raw, dict) or raw.get("confidence") not in _CONFIDENCE or not isinstance(raw.get("page"), int) or not isinstance(raw.get("line"), int):
        return None
    name, value = _text(raw.get("name"), 200), _text(raw.get("value"), 60)
    issues = raw.get("issues")
    # A row with no value is only ever one the parser says it could not finish, for a person to complete.
    if not name or (not value and not (isinstance(issues, list) and issues)):
        return None
    value = value or ""
    return {
        "name": name, "value": value, "unit": _text(raw.get("unit"), 40), "reference": _text(raw.get("reference"), 60), "flag": _text(raw.get("flag"), 12),
        "collected": _text(raw.get("collected"), 10), "reported": _text(raw.get("reported"), 10), "page": raw["page"], "line": raw["line"], "source": _text(raw.get("source"), 200) or "",
        "confidence": raw["confidence"], "issues": [str(i)[:200] for i in issues][:6] if isinstance(issues, list) else [],
    }


def _clean_patient(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    pages = lambda e: e["page"] if isinstance(e.get("page"), int) else None  # noqa: E731
    names = [{"value": n["value"][:120], "page": pages(n)} for n in raw.get("names") or [] if isinstance(n, dict) and _text(n.get("value"), 120)]
    births = [{"value": b["value"][:10], "other": _text(b.get("other"), 10), "page": pages(b)} for b in raw.get("births") or [] if isinstance(b, dict) and _text(b.get("value"), 10)]
    return {"names": names[:5], "births": births[:5]}


def parse_output(stdout: bytes) -> ExtractionResult:
    try:
        data = json.loads(stdout[:_MAX_OUTPUT])
    except ValueError:
        return ExtractionResult("failed")
    if not isinstance(data, dict) or data.get("status") not in _STATUSES:
        return ExtractionResult("failed")
    sha = data.get("text_sha256")
    count = data.get("page_count")
    return ExtractionResult(
        status=data["status"],
        page_count=count if isinstance(count, int) and count >= 0 else None,
        pages_read=int(data.get("pages_read") or 0),
        pages_with_text=int(data.get("pages_with_text") or 0),
        pages_failed=int(data.get("pages_failed") or 0),
        truncated=bool(data.get("truncated")),
        text_sha256=sha if isinstance(sha, str) and len(sha) == 64 else None,
        proposals=[p for p in map(_clean_proposal, data.get("proposals") or []) if p],
        lab_rows=[r for r in map(_clean_lab_row, data.get("lab_rows") or []) if r],
        patient=_clean_patient(data.get("patient")),
    )


def worker_command(limits: Limits, today: date) -> list[str]:
    payload = json.dumps({"cpu_seconds": limits.cpu_seconds, "memory_bytes": limits.memory_bytes, "max_pages": limits.max_pages, "max_chars": limits.max_chars})
    # -I ignores environment variables and the current directory, so nothing can steer what gets imported.
    return [sys.executable, "-I", "-m", "this_is_you.extraction.worker", payload, today.isoformat()]


class ReaderUnavailable(Exception):
    """The reader could not be reached at all. Says nothing about the document, which should stay in the queue."""


def _interpret(code: int, stdout: bytes) -> ExtractionResult:
    if code == TIMED_OUT or code in (EXIT_MEMORY, -signal.SIGXCPU, -signal.SIGKILL, -signal.SIGSEGV):
        return ExtractionResult("too_complex")
    if code != 0:
        return ExtractionResult("failed")
    return parse_output(stdout)


def run_command(command: list[str], wall_seconds: float, document: BinaryIO | int = subprocess.DEVNULL) -> ExtractionResult:
    # stderr goes nowhere: it could hold document text, and this is what keeps it out of every log.
    process = subprocess.Popen(command, stdin=document, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, close_fds=True, start_new_session=True)
    try:
        stdout, _ = process.communicate(timeout=wall_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        return ExtractionResult("too_complex")
    return _interpret(process.returncode, stdout)


def _read_remotely(socket_path: str, document: BinaryIO, limits: Limits, today: date) -> ExtractionResult:
    request = {
        "op": "read", "today": today.isoformat(), "wall_seconds": limits.wall_seconds,
        "limits": {"cpu_seconds": limits.cpu_seconds, "memory_bytes": limits.memory_bytes, "max_pages": limits.max_pages, "max_chars": limits.max_chars},
    }
    try:
        code, stdout = client_exchange(socket_path, request, document.fileno(), limits.wall_seconds + 15)
    except (FileNotFoundError, ConnectionRefusedError) as problem:
        raise ReaderUnavailable from problem
    except OSError:
        return ExtractionResult("failed")  # It had the file and then went away. Possibly because of the file, so no endless retry.
    return _interpret(code, stdout)


def extract(path: Path, limits: Limits = Limits(), today: date | None = None) -> ExtractionResult:
    try:
        with path.open("rb") as document:
            if (socket_path := reader_socket()) is not None:
                return _read_remotely(socket_path, document, limits, today or date.today())
            return run_command(wrap(worker_command(limits, today or date.today())), limits.wall_seconds, document)
    except OSError:
        return ExtractionResult("failed")
