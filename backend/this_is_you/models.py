"""Database tables. docs/data-model.md describes how later record types attach to these."""
from __future__ import annotations

import enum
from uuid import uuid4

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class DocumentType(str, enum.Enum):
    LAB = "lab"
    IMAGING = "imaging"
    NOTE = "note"
    PATHOLOGY = "pathology"
    PROCEDURE = "procedure"
    OTHER = "other"


class ExtractionStatus(str, enum.Enum):
    """What the machine managed to read. Says nothing about whether anyone has checked it."""

    PENDING = "pending"
    RUNNING = "running"
    EXTRACTED = "extracted"
    PARTIAL = "partial"  # Some pages had no readable text, or the file was past the reading limits.
    IMAGE_ONLY = "image_only"
    ENCRYPTED = "encrypted"
    NO_TEXT = "no_text"
    FAILED = "failed"
    TOO_COMPLEX = "too_complex"  # Stopped by the time or memory limit.


class ReviewStatus(str, enum.Enum):
    """Where a person is in the review workflow."""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class VerificationStatus(str, enum.Enum):
    """How many details a person has confirmed against the original."""

    UNVERIFIED = "unverified"
    PARTIALLY_VERIFIED = "partially_verified"
    VERIFIED = "verified"


class MetadataField(str, enum.Enum):
    DOCUMENT_TYPE = "document_type"
    SERVICE_DATE = "service_date"
    PROVIDER = "provider"
    REPORT_TITLE = "report_title"


class DecisionAction(str, enum.Enum):
    CONFIRMED = "confirmed"  # A person checked the proposal and it is right.
    CORRECTED = "corrected"  # A person replaced it.
    NOT_STATED = "not_stated"  # A person checked and the document does not say.


class Confidence(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


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
    extraction_status: Mapped[ExtractionStatus] = mapped_column(_stored_as_value(ExtractionStatus), nullable=False, default=ExtractionStatus.PENDING)
    review_status: Mapped[ReviewStatus] = mapped_column(_stored_as_value(ReviewStatus), nullable=False, default=ReviewStatus.NOT_STARTED)
    verification_status: Mapped[VerificationStatus] = mapped_column(_stored_as_value(VerificationStatus), nullable=False, default=VerificationStatus.UNVERIFIED)
    # Path relative to the originals directory. Built from the hash, never from user input.
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # ISO 8601 UTC text, so it survives SQLite with no timezone loss and sorts correctly.
    imported_at: Mapped[str] = mapped_column(String(32), nullable=False)

    imports: Mapped[list["ImportEvent"]] = relationship(back_populates="document", order_by="ImportEvent.id")
    runs: Mapped[list["ExtractionRun"]] = relationship(back_populates="document", order_by="ExtractionRun.id")
    decisions: Mapped[list["MetadataDecision"]] = relationship(back_populates="document", order_by="MetadataDecision.id")

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


class ExtractionRun(Base):
    """One attempt to read a document. Rerunning adds a row, and never touches a person's decisions."""

    __tablename__ = "extraction_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[ExtractionStatus] = mapped_column(_stored_as_value(ExtractionStatus), nullable=False)
    finished_at: Mapped[str] = mapped_column(String(32), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    pages_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_with_text: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Hash of the normalized text, to notice the same report saved as a different file.
    text_sha256: Mapped[str | None] = mapped_column(String(64), index=True)

    document: Mapped[Document] = relationship(back_populates="runs")
    proposals: Mapped[list["MetadataProposal"]] = relationship(back_populates="run", order_by="MetadataProposal.id")


class MetadataProposal(Base):
    """A value the rules inferred, with where it came from. Never counts as verified on its own."""

    __tablename__ = "metadata_proposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("extraction_runs.id"), nullable=False, index=True)
    field: Mapped[MetadataField] = mapped_column(_stored_as_value(MetadataField), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    confidence: Mapped[Confidence] = mapped_column(_stored_as_value(Confidence), nullable=False)
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    source_page: Mapped[int] = mapped_column(Integer, nullable=False)
    source_snippet: Mapped[str] = mapped_column(String(200), nullable=False)

    run: Mapped[ExtractionRun] = relationship(back_populates="proposals")


class MetadataDecision(Base):
    """What a person decided about a field. Append-only: the latest row for a field is current."""

    __tablename__ = "metadata_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    field: Mapped[MetadataField] = mapped_column(_stored_as_value(MetadataField), nullable=False)
    action: Mapped[DecisionAction] = mapped_column(_stored_as_value(DecisionAction), nullable=False)
    value: Mapped[str | None] = mapped_column(String(255))
    proposal_id: Mapped[int | None] = mapped_column(ForeignKey("metadata_proposals.id"))
    decided_at: Mapped[str] = mapped_column(String(32), nullable=False)

    document: Mapped[Document] = relationship(back_populates="decisions")
    proposal: Mapped[MetadataProposal | None] = relationship()
