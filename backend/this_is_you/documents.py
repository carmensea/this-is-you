"""Recording uploads and reading documents back."""
from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timezone
from urllib.parse import unquote

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .models import Document, ExtractionRun, ImportEvent, ImportItem, ImportItemState, ImportOutcome, MetadataDecision
from .storage import OriginalStore, ReceivedFile, UploadRejected, not_a_pdf

# Log ids and sizes only. Filenames and contents are health information and never go in a log.
log = logging.getLogger("this_is_you.documents")

PDF_MEDIA_TYPE = "application/pdf"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_filename(header_value: str | None) -> str:
    """Turn the client's filename into display text. It is never used to build a path."""
    if not header_value:
        raise UploadRejected(400, "missing_filename", "The upload did not include a filename. Nothing was stored.")
    try:
        name = unquote(header_value, errors="strict")
    except UnicodeDecodeError:
        raise UploadRejected(400, "missing_filename", "The filename could not be read. Nothing was stored.") from None
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = unicodedata.normalize("NFC", "".join(c for c in name if unicodedata.category(c)[0] != "C")).strip()
    if not name.lower().endswith(".pdf") or name.lower() == ".pdf":
        raise not_a_pdf()
    if len(name) > 255:
        stem = name[:-4]
        name = stem[:251] + name[-4:]
    return name


def _settle_item(session: Session, item_id: int | None, document: Document, duplicate: bool, now: str) -> None:
    if item_id is None:
        return
    item = session.get(ImportItem, item_id)
    assert item is not None
    item.state, item.document, item.message, item.updated_at = (ImportItemState.DUPLICATE if duplicate else ImportItemState.STORED), document, None, now


def record_upload(sessions: sessionmaker[Session], store: OriginalStore, received: ReceivedFile, filename: str, item_id: int | None = None) -> tuple[Document, bool]:
    """Store the file and its metadata. Returns the document and whether it already existed.

    A batch item changes in the same transaction, so a crash cannot leave a document its report does not know.
    """
    key = store.commit(received)  # File first: a crash here leaves an unlisted file, never a broken listing.
    with sessions() as session:
        document = session.scalar(select(Document).where(Document.sha256 == received.sha256))
        duplicate = document is not None
        now = utc_now()
        if document is None:
            document = Document(sha256=received.sha256, original_filename=filename, media_type=PDF_MEDIA_TYPE, byte_size=received.byte_size, storage_key=key, imported_at=now)
            session.add(document)
        session.add(ImportEvent(document=document, submitted_filename=filename, outcome=ImportOutcome.DUPLICATE if duplicate else ImportOutcome.STORED, occurred_at=now))
        _settle_item(session, item_id, document, duplicate, now)
        try:
            session.commit()
        except IntegrityError:
            # The same file arrived twice at once and the other upload won.
            session.rollback()
            document = session.scalars(select(Document).where(Document.sha256 == received.sha256)).one()
            duplicate = True
            session.add(ImportEvent(document=document, submitted_filename=filename, outcome=ImportOutcome.DUPLICATE, occurred_at=now))
            _settle_item(session, item_id, document, True, now)
            session.commit()
        document_id = document.id
    document = get_document(sessions, document_id)
    assert document is not None
    log.info("document %s: %s, %d bytes", document.id, "duplicate" if duplicate else "stored", received.byte_size)
    return document, duplicate


_FULL = (
    selectinload(Document.imports),
    selectinload(Document.runs).selectinload(ExtractionRun.proposals),
    selectinload(Document.decisions).selectinload(MetadataDecision.proposal),
)


def list_documents(sessions: sessionmaker[Session]) -> list[Document]:
    # shortcut: returns every document, which suits one person's archive. Page it if listings slow down.
    with sessions() as session:
        return list(session.scalars(select(Document).options(*_FULL).order_by(Document.imported_at.desc(), Document.id)))


def get_document(sessions: sessionmaker[Session], document_id: str) -> Document | None:
    with sessions() as session:
        return session.scalars(select(Document).options(*_FULL).where(Document.id == document_id)).one_or_none()
