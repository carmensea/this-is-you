"""Keeps the PDF reader away from everything but the one file it is handed.

The reader parses untrusted files, so the limits in worker.py assume it could be subverted. Those limits run inside the
process they restrict. This applies limits from outside before it starts: no network, no writing, and no reading anything
but Python itself.

- Production on Linux: the reader runs in its own container with no network and no archive. See reader_service.py.
- macOS development: sandbox-exec.
- Linux development: bubblewrap, where the system allows it. Stock Ubuntu 24.04 does not, on the host or inside Docker,
  and getting it to work there would mean weakening other protections. Tests on real Ubuntu are in docs/reports/.

Whichever applies, it is tested at start against what it should block, and a sandbox that fails counts as none.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("this_is_you.sandbox")

_PACKAGE = Path(__file__).resolve().parents[1]
FULL, BASIC, UNAVAILABLE = "sandboxed", "basic", "unavailable"
_canary_dir: Path | None = None
_required = False
_reader_socket: str | None = None
READER_WAIT_SECONDS = 30  # The two containers start together after a reboot.


class SandboxRequired(Exception):
    pass


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


# Runs inside the sandbox. A sandbox that starts is not proof of one that holds, so this tries what it is there to stop.
SELF_TEST = """
import _socket, errno, os, sys
escaped = []
def attempt(name, action):
    try:
        action()
        escaped.append(name)
    except OSError:
        pass
def outside():
    s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    s.settimeout(3)
    try:
        s.connect(("1.1.1.1", 53))
        escaped.append("network")
    except OSError as problem:
        # Refused outright, or no route at all. A timeout may just be a firewall, so it counts as a network being there.
        if problem.errno not in (errno.EPERM, errno.EACCES, errno.ENETUNREACH, errno.EHOSTUNREACH):
            escaped.append("network")
try:
    outside()
except OSError:
    escaped.append("network")
attempt("reading the archive", lambda: open(sys.argv[1], "rb").read(1))
attempt("writing to the archive", lambda: open(sys.argv[1] + ".written", "wb").write(b"x"))
attempt("writing to its own disk", lambda: open("/tiy-write-test", "wb").write(b"x"))
attempt("writing to its home", lambda: open(os.path.expanduser("~/tiy-write-test"), "wb").write(b"x"))
import this_is_you.extraction.worker, pypdf
print(",".join(sorted(set(escaped))))
"""


def _remote_self_test(canary: Path) -> list[str]:
    """The reader runs in its own container. This asks it to try the same escapes from there, aimed at a real file here."""
    from .reader_service import client_exchange

    deadline = time.monotonic() + READER_WAIT_SECONDS
    while True:
        try:
            code, output = client_exchange(_reader_socket, {"op": "self_test", "canary": str(canary)}, None, 90)
            break
        except OSError:
            if time.monotonic() > deadline:
                return ["the reader container did not answer"]
            time.sleep(1)
    if code != 0:
        return ["the reader container could not run its test"]
    return [name for name in output.decode(errors="replace").strip().split(",") if name]


def _self_test(canary_dir: Path | None) -> list[str]:
    """Empty when the sandbox starts, can run the reader, and blocks what it should. Otherwise, what went wrong."""
    with tempfile.TemporaryDirectory(dir=canary_dir, prefix=".sandbox-test-") as folder:
        canary = Path(folder) / "canary"
        canary.write_text("fictional")
        if _reader_socket is not None:
            return _remote_self_test(canary)
        command = _wrap([sys.executable, "-I", "-c", SELF_TEST, str(canary)])
        if command is None:
            return ["no sandbox tool"]
        try:
            answer = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, env={}, timeout=60)
        except (OSError, subprocess.SubprocessError):
            return ["the sandbox would not start"]
        if answer.returncode != 0:
            return ["the sandbox would not start"]
        return [name for name in answer.stdout.strip().split(",") if name]


def configure(canary_dir: Path | None, required: bool, reader_socket: str | None = None) -> None:
    global _canary_dir, _required, _reader_socket
    _canary_dir, _required, _reader_socket = canary_dir, required, reader_socket
    isolation.cache_clear()


@lru_cache(maxsize=1)
def isolation() -> str:
    """Tests the sandbox once per configuration. Where one is optional, a missing one must not fail every document."""
    problems = _self_test(_canary_dir)
    if not problems:
        return FULL
    # What failed, never document content. A sandbox that leaks is treated just like one that is missing.
    log.warning("The PDF reader's sandbox did not pass its test: %s.", ", ".join(problems))
    if _required:
        log.error("Reading is stopped until this is fixed. Files are still stored, and will be read after a restart.")
        return UNAVAILABLE
    return BASIC


def reader_socket() -> str | None:
    return _reader_socket


def wrap(command: list[str]) -> list[str]:
    level = isolation()
    if level == UNAVAILABLE:
        raise SandboxRequired  # The caller should not have got here. This is the last line of defense.
    return (_wrap(command) or command) if level == FULL else command
