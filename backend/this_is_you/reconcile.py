"""Squares the originals folder with the database when the service starts, before anything else can touch either.

A crash between storing a file and recording it leaves a file no document points to, which the app would never show
and backups would never copy. A file whose bytes match its name is complete, so it becomes a document again. Anything
else is moved aside for a person to look at. Nothing here deletes a file.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .documents import PDF_MEDIA_TYPE, recovered_name, utc_now
from .models import Document, ImportEvent, ImportOutcome

log = logging.getLogger("this_is_you.reconcile")  # Counts only.

_KEY = re.compile(r"([0-9a-f]{2})/([0-9a-f]{2})/(\1\2[0-9a-f]{60})\.pdf")
_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class Reconciled:
    recovered: int = 0
    set_aside: int = 0
    missing: int = 0


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _set_aside(path: Path, folder: Path) -> None:
    folder.mkdir(exist_ok=True, mode=0o700)
    target = folder / path.name
    for n in range(1, 10000):
        if not target.exists() and not target.is_symlink():
            break
        target = folder / f"{n}-{path.name}"
    os.rename(path, target)  # Moves a link itself, never what it points at.


def reconcile(settings: Settings, sessions: sessionmaker) -> Reconciled:
    originals, quarantine = settings.originals_dir, settings.quarantine_dir
    with sessions() as session:
        known = set(session.scalars(select(Document.storage_key)))
    seen: set[str] = set()
    recovered = 0
    for directory, _subdirs, names in os.walk(originals):
        for name in names:
            path = Path(directory) / name
            key = path.relative_to(originals).as_posix()
            if key in known and not path.is_symlink():
                seen.add(key)
                continue
            match = _KEY.fullmatch(key)
            if path.is_symlink() or not path.is_file() or not match or _hash(path) != match[3]:
                _set_aside(path, quarantine)
                continue
            path.chmod(0o400)
            now = utc_now()
            filename = recovered_name(match[3])
            with sessions() as session:
                document = Document(sha256=match[3], original_filename=filename, media_type=PDF_MEDIA_TYPE, byte_size=path.stat().st_size, storage_key=key, imported_at=now)
                session.add_all([document, ImportEvent(document=document, submitted_filename=filename, outcome=ImportOutcome.STORED, occurred_at=now)])
                session.commit()
            recovered += 1
    result = Reconciled(recovered, sum(1 for p in quarantine.iterdir()) if quarantine.is_dir() else 0, len(known - seen))
    if result != Reconciled():
        log.warning("archive check: %d recovered, %d set aside, %d missing", result.recovered, result.set_aside, result.missing)
    return result
