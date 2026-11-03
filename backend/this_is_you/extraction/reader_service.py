"""The PDF reader as its own process, for a container with no network and no archive: python -I -m ...reader_service SOCKET

The service sends one request at a time over a Unix socket, with the document attached as an already open, read-only
file. So this side never has a path to the archive and can only ever see the one file it was handed. It starts a new
worker for each document and keeps nothing between them. Only the fixed worker can be run: a request carries limits and
a date, never a command.
"""
from __future__ import annotations

import ctypes
import json
import os
import signal
import socket
import struct
import subprocess
import sys
from datetime import date

from .sandbox import SELF_TEST

MAX_REQUEST = 64 * 1024
MAX_OUTPUT = 2 * 1024 * 1024
_EXIT = struct.Struct(">i")
TIMED_OUT = -1000
_LIMIT_KEYS = {"cpu_seconds", "memory_bytes", "max_pages", "max_chars"}
_PR_SET_DUMPABLE = 4


def _run(command: list[str], stdin, wall_seconds: float) -> tuple[int, bytes]:
    # stderr goes nowhere, and the environment is empty, as in runner.py.
    process = subprocess.Popen(command, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, close_fds=True, start_new_session=True)
    try:
        stdout, _ = process.communicate(timeout=wall_seconds)
        code = process.returncode
    except subprocess.TimeoutExpired:
        code, stdout = TIMED_OUT, b""
    # Anything it left behind goes too, so nothing from one document is around to watch the next.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        pass
    process.kill()
    process.wait()
    return code, stdout


def _handle(connection: socket.socket) -> None:
    raw, fds, _flags, _address = socket.recv_fds(connection, MAX_REQUEST, 1)
    try:
        request = json.loads(raw)
        if request["op"] == "self_test":
            code, out = _run([sys.executable, "-I", "-c", SELF_TEST, str(request["canary"])], subprocess.DEVNULL, 60)
        elif request["op"] == "read":
            limits = request["limits"]
            if set(limits) != _LIMIT_KEYS or not all(isinstance(limits[k], int) for k in _LIMIT_KEYS) or len(fds) != 1:
                raise ValueError
            today = date.fromisoformat(request["today"]).isoformat()
            wall = float(request["wall_seconds"])
            command = [sys.executable, "-I", "-m", "this_is_you.extraction.worker", json.dumps(limits), today]
            code, out = _run(command, fds[0], min(wall, 600))
        else:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        code, out = 2, b""
    finally:
        for fd in fds:
            os.close(fd)
    connection.sendall(_EXIT.pack(code) + out[:MAX_OUTPUT])


def _socket_identity(path: str) -> tuple[int, int] | None:
    try:
        found = os.lstat(path)
    except OSError:
        return None
    return found.st_dev, found.st_ino


def _listen(path: str) -> tuple[socket.socket, tuple[int, int] | None]:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    server.listen(4)
    server.settimeout(5)
    return server, _socket_identity(path)


def serve(path: str) -> None:
    # A subverted worker runs as this same user. This keeps it from attaching to this process, which outlives it.
    if sys.platform == "linux" and ctypes.CDLL(None).prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        sys.exit("Could not protect the reader process.")
    os.umask(0o117)  # The socket: this user and the group shared with the service, nobody else.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    server, identity = _listen(path)
    while True:
        # A subverted worker can replace this socket, as it runs as this same user. It cannot outlive its one reading,
        # so the most that can leave behind is a dead file, which would stop all reading. This puts it right.
        if _socket_identity(path) != identity:
            server.close()
            server, identity = _listen(path)
        try:
            connection, _ = server.accept()
        except TimeoutError:
            continue
        with connection:
            try:
                connection.settimeout(660)
                _handle(connection)
            except OSError:
                pass  # The service went away. The next request starts clean.


def client_exchange(path: str, request: dict, fd: int | None, timeout: float) -> tuple[int, bytes]:
    """The service's side. Raises OSError if the reader cannot be reached at all."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(path)
        socket.send_fds(connection, [json.dumps(request).encode()], [fd] if fd is not None else [])
        received = bytearray()
        while len(received) < _EXIT.size + MAX_OUTPUT:
            chunk = connection.recv(65536)
            if not chunk:
                break
            received += chunk
    if len(received) < _EXIT.size:
        raise ConnectionError
    return _EXIT.unpack(bytes(received[: _EXIT.size]))[0], bytes(received[_EXIT.size :])


if __name__ == "__main__":
    serve(sys.argv[1])
