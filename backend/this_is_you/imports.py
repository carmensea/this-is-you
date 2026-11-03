"""Batches of files and the report on them. The report is what survives a closed browser or a crash."""
from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .documents import utc_now
from .identity import POSSIBLE_MISMATCH, UNDETERMINED, Profile, assess, load_profile
from .models import Document, ExtractionRun, ExtractionStatus as E, ImportBatch, ImportItem, ImportItemState as S
from .storage import UploadRejected

log = logging.getLogger("this_is_you.imports")

RETRYABLE_READS = (E.FAILED, E.TOO_COMPLEX)

# One word per file for the summary. Storage, reading and verification stay separate on each row.
CATEGORY = case(
    (ImportItem.state == S.PENDING, "waiting"),
    (ImportItem.state.in_((S.REJECTED, S.INTERRUPTED)), "failed"),
    (ImportItem.state == S.UNSUPPORTED, "unsupported"),
    (ImportItem.state == S.DUPLICATE, "duplicate"),
    (Document.extraction_status.in_((E.PENDING, E.RUNNING)), "reading"),
    (Document.extraction_status == E.EXTRACTED, "read"),
    (Document.extraction_status == E.PARTIAL, "partial"),
    (Document.extraction_status == E.IMAGE_ONLY, "scanned"),
    (Document.extraction_status == E.ENCRYPTED, "encrypted"),
    (Document.extraction_status == E.NO_TEXT, "no_text"),
    else_="failed",
)


def _missing() -> UploadRejected:
    return UploadRejected(404, "not_found", "No such import.")


def clean_path(raw: str) -> str:
    """Display text for where a file came from. Never used to open anything."""
    path = unicodedata.normalize("NFC", "".join(c for c in raw if unicodedata.category(c)[0] != "C")).replace("\\", "/").strip()
    return path[-1024:]


def create_batch(sessions: sessionmaker[Session], label: str) -> str:
    with sessions() as session:
        batch = ImportBatch(label=clean_path(label)[:255] or "Chosen files", created_at=utc_now())
        session.add(batch)
        session.commit()
        return batch.id


@dataclass(frozen=True)
class Listed:
    path: str
    byte_size: int
    modified_ms: int


def classify(listed: Listed, limit: int) -> tuple[S, str | None]:
    """What can be decided from the listing alone. Nothing is dropped: every file gets a row."""
    if not listed.path.lower().endswith(".pdf"):
        return S.UNSUPPORTED, "Only PDF files can be imported in this version. This file was not copied."
    if listed.byte_size > limit:
        return S.UNSUPPORTED, f"This file is larger than the {limit // (1024 * 1024)} MB limit. It was not copied."
    if listed.byte_size == 0:
        return S.REJECTED, "This file is empty. Nothing was stored."
    return S.PENDING, None


def add_items(sessions: sessionmaker[Session], batch_id: str, listed: list[Listed], limit: int) -> list[ImportItem]:
    """Adds what is new and returns every listed row. Listing a file twice is harmless, so a resume is too."""
    with sessions() as session:
        if session.get(ImportBatch, batch_id) is None:
            raise _missing()
        paths = [clean_path(x.path) for x in listed]
        known = {i.path: i for i in session.scalars(select(ImportItem).where(ImportItem.batch_id == batch_id, ImportItem.path.in_(paths)))}
        now = utc_now()
        for path, x in zip(paths, listed):
            if path not in known:
                state, message = classify(Listed(path, x.byte_size, x.modified_ms), limit)
                known[path] = ImportItem(batch_id=batch_id, path=path, byte_size=x.byte_size, modified_ms=x.modified_ms, state=state, message=message, updated_at=now)
                session.add(known[path])
        session.commit()
        return [known[p] for p in paths]


def get_item(sessions: sessionmaker[Session], batch_id: str, item_id: int) -> ImportItem:
    with sessions() as session:
        item = session.scalars(_rows().where(ImportItem.id == item_id, ImportItem.batch_id == batch_id)).one_or_none()
        if item is None:
            raise _missing()
        return item


def begin_attempt(sessions: sessionmaker[Session], batch_id: str, item_id: int) -> ImportItem:
    with sessions() as session:
        item = session.get(ImportItem, item_id)
        if item is None or item.batch_id != batch_id:
            raise _missing()
        item.attempts += 1
        session.commit()
        return item


def mark_problem(sessions: sessionmaker[Session], item_id: int, state: S, message: str) -> None:
    with sessions() as session:
        item = session.get(ImportItem, item_id)
        # A stored file stays stored, whatever a later attempt does.
        if item is not None and item.state not in (S.STORED, S.DUPLICATE):
            item.state, item.message, item.updated_at = state, message[:300], utc_now()
            session.commit()


def _rows():
    return select(ImportItem).options(selectinload(ImportItem.document).selectinload(Document.runs))


def _identity_by_document(session: Session, batch_id: str, profile: Profile | None) -> dict[str, str]:
    found = dict(session.execute(
        select(ExtractionRun.document_id, ExtractionRun.patient_found)
        .join(ImportItem, ImportItem.document_id == ExtractionRun.document_id)
        .where(ImportItem.batch_id == batch_id)
        .order_by(ExtractionRun.id)
    ).all())  # Ordered by id, so the latest reading wins.
    ids = session.scalars(select(ImportItem.document_id).where(ImportItem.batch_id == batch_id, ImportItem.document_id.is_not(None))).all()
    return {d: assess(profile, found.get(d)).status for d in ids}


def summaries(sessions: sessionmaker[Session]) -> list[dict]:
    """Newest first. The counts come from a single query, so polling stays cheap on a long report."""
    profile = load_profile(sessions)
    with sessions() as session:
        batches = session.scalars(select(ImportBatch).where(ImportBatch.hidden.is_(False)).order_by(ImportBatch.created_at.desc(), ImportBatch.id)).all()
        rows = session.execute(
            select(ImportItem.batch_id, CATEGORY, func.count()).outerjoin(Document, ImportItem.document_id == Document.id).group_by(ImportItem.batch_id, CATEGORY)
        ).all()
        counts: dict[str, dict[str, int]] = {}
        for batch_id, category, n in rows:
            counts.setdefault(batch_id, {})[category] = n
        out = []
        for b in batches:
            identities = _identity_by_document(session, b.id, profile)
            out.append({
                "id": b.id, "label": b.label, "created_at": b.created_at, "counts": counts.get(b.id, {}), "total": sum(counts.get(b.id, {}).values()),
                "identity_mismatches": sum(v == POSSIBLE_MISMATCH for v in identities.values()), "identity_undetermined": sum(v == UNDETERMINED for v in identities.values()),
            })
        return out


def list_items(sessions: sessionmaker[Session], batch_id: str, category: str | None, identity: str | None, offset: int, limit: int) -> tuple[list[ImportItem], int]:
    profile = load_profile(sessions)
    with sessions() as session:
        if session.get(ImportBatch, batch_id) is None:
            raise _missing()
        where = [ImportItem.batch_id == batch_id]
        if category:
            where.append(CATEGORY == category)
        if identity:
            where.append(ImportItem.document_id.in_([d for d, status in _identity_by_document(session, batch_id, profile).items() if status == identity]))
        total = session.scalar(select(func.count()).select_from(ImportItem).outerjoin(Document, ImportItem.document_id == Document.id).where(*where))
        items = session.scalars(_rows().outerjoin(Document, ImportItem.document_id == Document.id).where(*where).order_by(ImportItem.path).offset(offset).limit(limit)).unique().all()
        return list(items), total or 0


def documents_to_reread(sessions: sessionmaker[Session], batch_id: str, item_id: int | None = None) -> list[str]:
    """Stored files whose reading failed go back in the line. Their originals and decisions are untouched."""
    with sessions() as session:
        where = [ImportItem.batch_id == batch_id, ImportItem.state == S.STORED, Document.extraction_status.in_(RETRYABLE_READS)]
        if item_id is not None:
            where.append(ImportItem.id == item_id)
        documents = session.scalars(select(Document).join(ImportItem, ImportItem.document_id == Document.id).where(*where)).unique().all()
        for d in documents:
            d.extraction_status = E.PENDING
        session.commit()
        return [d.id for d in documents]


def hide_batch(sessions: sessionmaker[Session], batch_id: str) -> None:
    with sessions() as session:
        batch = session.get(ImportBatch, batch_id)
        if batch is None:
            raise _missing()
        batch.hidden = True
        session.commit()


