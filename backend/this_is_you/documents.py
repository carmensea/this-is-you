"""Recording uploads and reading documents back."""
from __future__ import annotations

import logging
import os
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .models import Document, ExtractionRun, ExtractionStatus, ImportBatch, ImportEvent, ImportItem, ImportItemState, ImportOutcome, MetadataDecision, MetadataProposal, Observation, ObservationRevision, ReviewGroupApproval
from .storage import OriginalStore, ReceivedFile, UploadRejected, _sync_directory, not_a_pdf

# Log ids and sizes only. Filenames and contents are health information and never go in a log.
log = logging.getLogger("this_is_you.documents")

PDF_MEDIA_TYPE = "application/pdf"
RECOVERED_PREFIX = "Recovered file "
RECOVERED_NOTE = "Recovered after an interrupted import. The stored file matched this one exactly."


def recovered_name(sha256: str) -> str:
    """The name recovery gives a file. Holding it means the upload it came from has not come back yet."""
    return f"{RECOVERED_PREFIX}{sha256[:12]}.pdf"


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


def _settle_item(session: Session, item_id: int | None, document: Document, duplicate: bool, now: str, message: str | None = None) -> None:
    if item_id is None:
        return
    item = session.get(ImportItem, item_id)
    assert item is not None
    item.state, item.document, item.message, item.updated_at = (ImportItemState.DUPLICATE if duplicate else ImportItemState.STORED), document, message, now


def record_upload(sessions: sessionmaker[Session], store: OriginalStore, received: ReceivedFile, filename: str, item_id: int | None = None) -> tuple[Document, bool]:
    """Store the file and its metadata. Returns the document and whether it already existed.

    A batch item changes in the same transaction, so a crash cannot leave a document its report does not know.
    A crash just before that transaction leaves a recovered document. The first upload of those bytes is the one that
    was interrupted, so it takes the document as its own, and clearing the name means no later upload can.
    """
    key = store.commit(received)  # File first: a crash here leaves an unlisted file, never a broken listing.
    with sessions() as session:
        # The write lock comes first, so two copies arriving together cannot both take a recovered document.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        document = session.scalar(select(Document).where(Document.sha256 == received.sha256))
        recovered = document is not None and document.original_filename == recovered_name(received.sha256)
        duplicate = document is not None and not recovered
        now = utc_now()
        if recovered:
            document.original_filename = filename  # The name was lost in a crash, and this upload knows it.
        if document is None:
            document = Document(sha256=received.sha256, original_filename=filename, media_type=PDF_MEDIA_TYPE, byte_size=received.byte_size, storage_key=key, imported_at=now)
            session.add(document)
        session.add(ImportEvent(document=document, submitted_filename=filename, outcome=ImportOutcome.DUPLICATE if duplicate else ImportOutcome.STORED, occurred_at=now))
        _settle_item(session, item_id, document, duplicate, now, RECOVERED_NOTE if recovered else None)
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


def _remove_rows(session: Session, document_id: str) -> None:
    observations = select(Observation.id).where(Observation.document_id == document_id)
    runs = select(ExtractionRun.id).where(ExtractionRun.document_id == document_id)
    batches = set(session.scalars(select(ImportItem.batch_id).where(ImportItem.document_id == document_id)))
    session.execute(delete(ObservationRevision).where(ObservationRevision.observation_id.in_(observations)))
    session.execute(delete(Observation).where(Observation.document_id == document_id))
    session.execute(delete(ReviewGroupApproval).where(ReviewGroupApproval.document_id == document_id))
    session.execute(delete(MetadataDecision).where(MetadataDecision.document_id == document_id))
    session.execute(delete(MetadataProposal).where(MetadataProposal.run_id.in_(runs)))
    session.execute(delete(ExtractionRun).where(ExtractionRun.document_id == document_id))
    session.execute(delete(ImportEvent).where(ImportEvent.document_id == document_id))
    session.execute(delete(ImportItem).where(ImportItem.document_id == document_id))
    for batch in batches:  # A report with nothing left in it would only keep the folder's name.
        if session.scalar(select(ImportItem.id).where(ImportItem.batch_id == batch).limit(1)) is None:
            session.execute(delete(ImportBatch).where(ImportBatch.id == batch))
    session.execute(delete(Document).where(Document.id == document_id))


def _remove_original(path: Path, marker: Path) -> None:
    path.unlink(missing_ok=True)
    _sync_directory(path.parent)
    marker.unlink(missing_ok=True)


def delete_document(sessions: sessionmaker[Session], store: OriginalStore, deleting_dir: Path, document_id: str) -> None:
    """Removes a document and everything known from it, for good. Other documents are not touched.

    A note written first says the file is going. Without it, a crash after the rows go would leave a file with no
    record, and the next start would bring it back as a recovered document.
    """
    deleting_dir.mkdir(exist_ok=True, mode=0o700)
    with sessions() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        document = session.get(Document, document_id)
        if document is None:
            raise UploadRejected(404, "not_found", "No such document.")
        if document.extraction_status in (ExtractionStatus.PENDING, ExtractionStatus.RUNNING):
            raise UploadRejected(409, "still_reading", "This document is still being read. Try again when it finishes.")
        path, marker = store.path_for(document.storage_key), deleting_dir / document.sha256
        fd = os.open(marker, os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        _sync_directory(deleting_dir)
        _remove_rows(session, document_id)
        session.commit()
    _remove_original(path, marker)
    with sessions() as session:  # Clears the removed rows from the write-ahead log too.
        session.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    log.info("document %s: deleted", document_id)


def finish_deletions(sessions: sessionmaker[Session], store: OriginalStore, deleting_dir: Path) -> None:
    """After a crash. If the document's rows went, its file goes too. If they did not, nothing happened, so it stays."""
    if not deleting_dir.is_dir():
        return
    for marker in deleting_dir.iterdir():
        sha256 = marker.name
        try:
            path = store.path_for(f"{sha256[:2]}/{sha256[2:4]}/{sha256}.pdf")
        except ValueError:
            continue  # Not a note this app wrote.
        with sessions() as session:
            still_here = session.scalar(select(Document.id).where(Document.sha256 == sha256)) is not None
        if still_here:
            marker.unlink(missing_ok=True)
        else:
            _remove_original(path, marker)
