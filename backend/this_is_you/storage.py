"""The file store for originals. Bytes are written once and never changed."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

_SHA256 = re.compile(r"[0-9a-f]{64}")
_KEEP_HEAD = 1024
_KEEP_TAIL = 4096


class UploadRejected(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


def not_a_pdf() -> UploadRejected:
    return UploadRejected(415, "not_pdf", "This file is not a readable PDF. Nothing was stored.")


def too_large(limit: int) -> UploadRejected:
    return UploadRejected(413, "too_large", f"This file is larger than the {limit // (1024 * 1024)} MB limit. Nothing was stored.")


@dataclass(frozen=True)
class ReceivedFile:
    temp_path: Path
    sha256: str
    byte_size: int


def _sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class OriginalStore:
    def __init__(self, originals_dir: Path, incoming_dir: Path) -> None:
        self.originals_dir, self.incoming_dir = originals_dir, incoming_dir
        for directory in (originals_dir, incoming_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory.chmod(0o700)

    def discard_incomplete(self) -> None:
        """Remove partial uploads left behind by a crash."""
        for leftover in self.incoming_dir.iterdir():
            leftover.unlink(missing_ok=True)

    async def receive_pdf(self, chunks: AsyncIterator[bytes], max_bytes: int) -> ReceivedFile:
        """Stream an upload to a private temp file while hashing and validating it."""
        fd, name = tempfile.mkstemp(dir=self.incoming_dir, suffix=".part")  # mode 0600
        temp_path = Path(name)
        digest, size, head, tail = hashlib.sha256(), 0, b"", b""
        try:
            with os.fdopen(fd, "wb") as out:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > max_bytes:
                        raise too_large(max_bytes)
                    digest.update(chunk)
                    out.write(chunk)
                    if len(head) < _KEEP_HEAD:
                        head = (head + chunk)[:_KEEP_HEAD]
                    tail = (tail + chunk)[-_KEEP_TAIL:]
                out.flush()
                os.fsync(out.fileno())
            if size == 0:
                raise UploadRejected(400, "empty", "This file is empty. Nothing was stored.")
            # The two markers every PDF reader relies on. A truncated download fails the second.
            if b"%PDF-" not in head or b"%%EOF" not in tail:
                raise not_a_pdf()
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise
        return ReceivedFile(temp_path, digest.hexdigest(), size)

    def commit(self, received: ReceivedFile) -> str:
        """Move a received file into place and return its storage key. Same bytes, same place."""
        key = f"{received.sha256[:2]}/{received.sha256[2:4]}/{received.sha256}.pdf"
        final = self.originals_dir / key
        if final.exists():
            received.temp_path.unlink(missing_ok=True)
            return key
        final.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        received.temp_path.chmod(0o400)
        os.replace(received.temp_path, final)
        _sync_directory(final.parent)
        return key

    def path_for(self, key: str) -> Path:
        """Resolve a storage key, refusing anything that is not a key this store could have made."""
        parts = key.split("/")
        if len(parts) != 3 or not _SHA256.fullmatch(parts[2].removesuffix(".pdf")) or parts[:2] != [parts[2][:2], parts[2][2:4]]:
            raise ValueError("invalid storage key")
        path = (self.originals_dir / key).resolve()
        if not path.is_relative_to(self.originals_dir.resolve()):
            raise ValueError("invalid storage key")
        return path
