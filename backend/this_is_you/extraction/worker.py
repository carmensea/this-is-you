"""One PDF, one process, then exit. Run by runner.py: python -I -m this_is_you.extraction.worker PATH LIMITS TODAY

Prints a JSON summary and nothing else. The full text never leaves this process, and errors are reduced
to a status word so that document content cannot reach a log through a traceback.
"""
from __future__ import annotations

import hashlib
import json
import os
import resource
import socket
import sys
import threading
import time
from datetime import date

EXIT_MEMORY = 71
MIN_TEXT_CHARS = 20  # Fewer than this on a page counts as no text: scans often carry a stray mark or two.


def apply_limits(limits: dict) -> None:
    """Called before touching the file. Limits that this OS does not enforce are backstopped elsewhere."""
    seconds, memory = limits["cpu_seconds"], limits["memory_bytes"]
    resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds + 2))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))  # A core dump would hold document text.
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))  # May not write to any file.
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    except (ValueError, OSError):
        pass  # macOS does not support this limit, so the watchdog below covers it.

    # ru_maxrss is bytes on macOS and kilobytes on Linux.
    unit = 1 if sys.platform == "darwin" else 1024

    def watchdog() -> None:
        while True:
            if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * unit > memory:
                os._exit(EXIT_MEMORY)
            time.sleep(0.05)

    threading.Thread(target=watchdog, daemon=True).start()


def forbid_network() -> None:
    """Nothing here needs the network. This makes that a guarantee for Python code, not an assumption."""

    def refuse(*_args, **_kwargs):
        raise OSError("network access is disabled in the document reader")

    socket.socket = refuse  # type: ignore[assignment,misc]
    socket.create_connection = refuse  # type: ignore[assignment]
    socket.getaddrinfo = refuse  # type: ignore[assignment]


def _has_image(page) -> bool:
    # Checks the page's resources without decoding any image data.
    try:
        objects = page.get("/Resources", {}).get_object().get("/XObject", {}).get_object()
        return any(objects[name].get_object().get("/Subtype") == "/Image" for name in objects)
    except Exception:
        return False


def read_pdf(path: str, limits: dict, today: date) -> dict:
    from pypdf import PdfReader

    from .lab_rows import parse_lab_rows
    from .rules import propose_all

    summary: dict = {"status": "failed", "page_count": None, "pages_read": 0, "pages_with_text": 0, "pages_failed": 0, "truncated": False, "text_sha256": None, "proposals": [], "lab_rows": []}
    try:
        reader = PdfReader(path, strict=False)
        if reader.is_encrypted:
            return {**summary, "status": "encrypted"}
        page_count = len(reader.pages)
    except Exception:
        return summary
    summary["page_count"] = page_count
    if page_count == 0:
        return summary

    pages: list[tuple[int, str]] = []
    images, chars, failed = 0, 0, 0
    to_read = min(page_count, limits["max_pages"])
    truncated = page_count > to_read
    for number in range(to_read):
        try:
            page = reader.pages[number]
            text = page.extract_text() or ""
        except Exception:
            failed += 1
            continue
        if len(text.strip()) >= MIN_TEXT_CHARS:
            room = limits["max_chars"] - chars
            if room <= 0:
                truncated = True
                break
            text = text[:room]
            truncated = truncated or len(text) == room
            chars += len(text)
            pages.append((number + 1, text))
        elif _has_image(page):
            images += 1

    summary.update(pages_read=to_read, pages_with_text=len(pages), pages_failed=failed, truncated=truncated)
    if not pages:
        summary["status"] = "image_only" if images else ("failed" if failed == to_read else "no_text")
        return summary
    summary["status"] = "partial" if truncated or failed or len(pages) < to_read else "extracted"
    normalized = " ".join(" ".join(text for _, text in pages).lower().split())
    if len(normalized) >= 100:
        summary["text_sha256"] = hashlib.sha256(normalized.encode("utf-8", "ignore")).hexdigest()
    try:
        embedded = reader.metadata.title if reader.metadata else None
    except Exception:
        embedded = None
    summary["proposals"] = [p.as_dict() for p in propose_all(pages, embedded if isinstance(embedded, str) else None, today)]
    rows = parse_lab_rows(pages, today)
    if not rows:
        # Tables often come out as separate lines in the default mode. Layout mode keeps columns together.
        try:
            laid_out = [(number, reader.pages[number - 1].extract_text(extraction_mode="layout") or "") for number, _ in pages]
            rows = parse_lab_rows(laid_out, today)
        except Exception:
            rows = []
    summary["lab_rows"] = [r.as_dict() for r in rows]
    return summary


def main() -> None:
    path, limits, today = sys.argv[1], json.loads(sys.argv[2]), date.fromisoformat(sys.argv[3])
    import pypdf  # noqa: F401  Loaded before limits apply, so its own size does not count against them.

    apply_limits(limits)
    forbid_network()
    sys.setrecursionlimit(limits.get("recursion", 2000))
    try:
        result = read_pdf(path, limits, today)
    except (MemoryError, RecursionError):
        result = {"status": "too_complex"}
    except Exception:
        result = {"status": "failed"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    os._exit(0)  # Skips interpreter teardown, which can be slow after a hostile file.


if __name__ == "__main__":
    main()
