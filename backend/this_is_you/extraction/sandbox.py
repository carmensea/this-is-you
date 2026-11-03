"""Runs the PDF reader inside an operating-system sandbox, where one exists.

The reader parses untrusted files, so the limits in worker.py assume it could be subverted. Those limits run inside the
process they restrict. These are applied from outside before it starts: no network, no writing, and no reading anything
but Python itself. The document arrives as an already open file, so the archive folder is not visible at all.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("this_is_you.sandbox")

_PACKAGE = Path(__file__).resolve().parents[1]
FULL, BASIC = "sandboxed", "basic"


def _readable() -> list[Path]:
    # The folder holding the package has to be listable for Python to find it. Its other contents are not opened.
    return sorted({Path(p).resolve() for p in (sys.prefix, sys.base_prefix, _PACKAGE)})


def _macos(command: list[str]) -> list[str]:
    quoted = lambda p: str(p).replace("\\", "\\\\").replace('"', '\\"')  # noqa: E731
    allowed = " ".join(f'(subpath "{quoted(p)}")' for p in _readable())
    profile = f"""(version 1)
(allow default)
(deny network*)
(deny file-write*)
(deny process-fork)
(deny appleevent-send)
(deny ipc-posix*)
(deny mach-lookup)
(deny signal (target others))
(deny file-read-data (subpath "/"))
(allow file-read-data {allowed} (literal "/") (literal "{quoted(_PACKAGE.parent)}") (subpath "/usr") (subpath "/System") (subpath "/Library/Apple") (subpath "/private/var/db/oah") (subpath "/private/var/db/dyld") (subpath "/dev"))
"""
    return ["/usr/bin/sandbox-exec", "-p", profile, *command]


def _linux(command: list[str], bwrap: str) -> list[str]:
    binds = [arg for p in _readable() for arg in ("--ro-bind", str(p), str(p))]
    system = [arg for p in ("/usr", "/lib", "/lib64", "/bin", "/etc/ld.so.cache") for arg in ("--ro-bind-try", p, p)]
    return [bwrap, "--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--dev", "/dev", "--tmpfs", "/tmp", *system, *binds, "--", *command]


def _wrap(command: list[str]) -> list[str] | None:
    if sys.platform == "darwin" and Path("/usr/bin/sandbox-exec").exists():
        return _macos(command)
    if sys.platform == "linux" and (bwrap := shutil.which("bwrap")):
        return _linux(command, bwrap)
    return None


@lru_cache(maxsize=1)
def isolation() -> str:
    """Tries the sandbox once. A sandbox that cannot start must not turn every document into a failed reading."""
    probe = _wrap([sys.executable, "-I", "-c", "import this_is_you.extraction.worker, pypdf"])
    if probe is not None:
        try:
            if subprocess.run(probe, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={}, timeout=60).returncode == 0:
                return FULL
        except (OSError, subprocess.SubprocessError):
            pass
    log.warning("The PDF reader has no operating-system sandbox here. On Linux, install bubblewrap (bwrap).")
    return BASIC


def wrap(command: list[str]) -> list[str]:
    return (_wrap(command) or command) if isolation() == FULL else command
