"""Database tables. docs/data-model.md describes how later record types attach to these."""
from __future__ import annotations

import enum
from uuid import uuid4

from sqlalchemy import Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class DocumentType(str, enum.Enum):
    """What kind of record a document is. Nothing classifies documents yet."""

    UNCLASSIFIED = "unclassified"
    LAB = "lab"
    IMAGING = "imaging"
    NOTE = "note"
    PATHOLOGY = "pathology"
    PROCEDURE = "procedure"
    OTHER = "other"


class ProcessingStatus(str, enum.Enum):
    """How far a document has moved through the pipeline. Uploads stop at UPLOADED for now."""

    UPLOADED = "uploaded"
    PARSED = "parsed"
    REVIEWED = "reviewed"
    UNSUPPORTED = "unsupported"


class ImportOutcome(str, enum.Enum):
    STORED = "stored"
    DUPLICATE = "duplicate"


def _stored_as_value(enum_cls: type[enum.Enum]) -> Enum:
    # Plain strings with no database constraint, so adding a value needs no table rebuild.
    return Enum(enum_cls, native_enum=False, create_constraint=False, length=32, values_callable=lambda e: [m.value for m in e])


class Document(Base):
    """One original file. Identical bytes are always one document."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
    sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(127), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    document_type: Mapped[DocumentType] = mapped_column(_stored_as_value(DocumentType), nullable=False, default=DocumentType.UNCLASSIFIED)
    processing_status: Mapped[ProcessingStatus] = mapped_column(_stored_as_value(ProcessingStatus), nullable=False, default=ProcessingStatus.UPLOADED)
    # Path relative to the originals directory. Built from the hash, never from user input.
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # ISO 8601 UTC text, so it survives SQLite with no timezone loss and sorts correctly.
    imported_at: Mapped[str] = mapped_column(String(32), nullable=False)

    imports: Mapped[list["ImportEvent"]] = relationship(back_populates="document", order_by="ImportEvent.id")

    __table_args__ = (Index("ix_documents_imported_at", "imported_at"),)


class ImportEvent(Base):
    """Every time a file arrived, including duplicates. The provenance of the document itself."""

    __tablename__ = "import_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    submitted_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    outcome: Mapped[ImportOutcome] = mapped_column(_stored_as_value(ImportOutcome), nullable=False)
    occurred_at: Mapped[str] = mapped_column(String(32), nullable=False)

    document: Mapped[Document] = relationship(back_populates="imports")
