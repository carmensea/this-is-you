"""Encrypted backups: one file that a finished, checked backup folder is sealed into.

A key comes from the passphrase with scrypt. The folder's tar stream is split into chunks, each sealed with AES-256-GCM.
Each chunk's nonce holds its position and whether it is the last, and every chunk authenticates the header. So changing,
reordering, removing or adding anything, including cutting the end off, fails to open. Without the passphrase this
also means nobody can forge a backup, which the plain manifest's checksum cannot promise.
"""
from __future__ import annotations

import hashlib
import io
import os
import secrets
import struct
import tarfile
import unicodedata
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"TIYBACKUP1\n"
EXTENSION = ".tiyb"
_HEADER = struct.Struct(">16sBBB7sI")  # salt, log2 n, r, p, nonce prefix, chunk size
_CHUNK = 1024 * 1024
_LOG2_N, _R, _P = 17, 8, 1
_MAX_LOG2_N = 20  # The header is untrusted until the first chunk opens, so it cannot demand unlimited memory.
_MAX_CHUNK = 16 * 1024 * 1024
_LENGTH = struct.Struct(">I")
MIN_PASSPHRASE = 12


class CannotOpen(Exception):
    """The passphrase is wrong, or the file was damaged or changed. Encryption cannot tell these apart."""


def _key(passphrase: str, salt: bytes, log2_n: int, r: int, p: int) -> bytes:
    # The same words typed on a phone and a laptop can differ in Unicode form.
    return hashlib.scrypt(unicodedata.normalize("NFKC", passphrase).encode(), salt=salt, n=2**log2_n, r=r, p=p, maxmem=(2**log2_n) * r * 256, dklen=32)


def _nonce(prefix: bytes, counter: int, last: bool) -> bytes:
    return prefix + struct.pack(">I", counter) + (b"\x01" if last else b"\x00")


class _SealingWriter(io.RawIOBase):
    def __init__(self, out, passphrase: str) -> None:
        salt, self._prefix = secrets.token_bytes(16), secrets.token_bytes(7)
        self._header = MAGIC + _HEADER.pack(salt, _LOG2_N, _R, _P, self._prefix, _CHUNK)
        self._aead = AESGCM(_key(passphrase, salt, _LOG2_N, _R, _P))
        self._out, self._buffer, self._counter = out, bytearray(), 0
        out.write(self._header)

    def writable(self) -> bool:
        return True

    def _seal(self, plain: bytes, last: bool) -> None:
        sealed = self._aead.encrypt(_nonce(self._prefix, self._counter, last), plain, self._header)
        self._out.write(_LENGTH.pack(len(sealed)) + sealed)
        self._counter += 1

    def write(self, data) -> int:
        self._buffer += data
        # Holds back a full chunk, so the last one written is always the one marked last.
        while len(self._buffer) > _CHUNK:
            self._seal(bytes(self._buffer[:_CHUNK]), False)
            del self._buffer[:_CHUNK]
        return len(data)

    def finish(self) -> None:
        self._seal(bytes(self._buffer), True)
        self._buffer.clear()


class _OpeningReader(io.RawIOBase):
    def __init__(self, source, passphrase: str) -> None:
        self._source = source
        magic = source.read(len(MAGIC))
        raw = source.read(_HEADER.size)
        if magic != MAGIC or len(raw) != _HEADER.size:
            raise CannotOpen
        salt, log2_n, r, p, self._prefix, self._chunk = _HEADER.unpack(raw)
        if not (10 <= log2_n <= _MAX_LOG2_N and 1 <= r <= 32 and 1 <= p <= 16 and 0 < self._chunk <= _MAX_CHUNK):
            raise CannotOpen
        self._header = magic + raw
        self._aead = AESGCM(_key(passphrase, salt, log2_n, r, p))
        self._plain, self._counter = b"", 0
        self.finished = False

    def readable(self) -> bool:
        return True

    def _next(self) -> None:
        length_raw = self._source.read(_LENGTH.size)
        if len(length_raw) != _LENGTH.size:
            raise CannotOpen
        length = _LENGTH.unpack(length_raw)[0]
        if length > self._chunk + 16:
            raise CannotOpen
        sealed = self._source.read(length)
        if len(sealed) != length:
            raise CannotOpen
        # Only one of the two can open, and which one says whether this really is the end.
        for last in (False, True):
            try:
                self._plain = self._aead.decrypt(_nonce(self._prefix, self._counter, last), sealed, self._header)
                break
            except InvalidTag:
                if last:
                    raise CannotOpen from None
        self._counter += 1
        if last:
            if self._source.read(1):
                raise CannotOpen
            self.finished = True

    def readinto(self, target) -> int:
        while not self._plain and not self.finished:
            self._next()
        count = min(len(target), len(self._plain))
        target[:count] = self._plain[:count]
        self._plain = self._plain[count:]
        return count


def seal_folder(folder: Path, target: Path, passphrase: str) -> None:
    """Writes `target` from a finished backup folder and flushes it to disk."""
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as out:
        writer = _SealingWriter(out, passphrase)
        with tarfile.open(fileobj=writer, mode="w|") as archive:
            for path in sorted(p for p in folder.rglob("*") if p.is_file() and not p.is_symlink()):
                archive.add(path, arcname=path.relative_to(folder).as_posix(), recursive=False)
        writer.finish()
        out.flush()
        os.fsync(out.fileno())


def open_into(source: Path, target: Path, passphrase: str) -> None:
    """Unseals into an empty private folder. Everything is authenticated, and the end of the file has to be reached."""
    target.mkdir(mode=0o700)
    try:
        with source.open("rb") as f:
            reader = _OpeningReader(f, passphrase)
            with tarfile.open(fileobj=io.BufferedReader(reader, _CHUNK), mode="r|") as archive:
                archive.extractall(target, filter="data")
            while not reader.finished:  # Tar stops at its end marker. The sealed stream has to end there as well.
                if reader.read(_CHUNK) == b"":
                    break
            if not reader.finished:
                raise CannotOpen
    except (tarfile.TarError, OSError, ValueError) as problem:
        if isinstance(problem, OSError) and not isinstance(problem, tarfile.TarError) and problem.errno is not None:
            raise  # A full disk, not a damaged backup.
        raise CannotOpen from None
