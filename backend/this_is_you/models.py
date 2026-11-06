"""Database tables. docs/data-model.md describes how later record types attach to these."""
from __future__ import annotations

import enum
from uuid import uuid4

from sqlalchemy import JSON, BigInteger, Boolean, Enum, Float, ForeignKey, Index, Integer, String, UniqueConstraint
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


class ObservationOrigin(str, enum.Enum):
    EXTRACTED = "extracted"
    MANUAL = "manual"
    FHIR = "fhir"  # Read from a connected provider. Proposed like any other result.


class ObservationVerification(str, enum.Enum):
    """Only VERIFIED observations ever reach a chart. The change takes a person's explicit approval."""

    PROPOSED = "proposed"
    VERIFIED = "verified"
    REJECTED = "rejected"


class ObservationExtraction(str, enum.Enum):
    """How cleanly a row was read. Says nothing about whether it is right."""

    PARSED = "parsed"
    AMBIGUOUS = "ambiguous"
    NOT_EXTRACTED = "not_extracted"  # Entered by a person.


class RevisionAction(str, enum.Enum):
    EXTRACTED = "extracted"
    ENTERED = "entered"
    CORRECTED = "corrected"
    VERIFIED = "verified"
    REJECTED = "rejected"
    REOPENED = "reopened"
    IMPORTED = "imported"  # Read from a connected provider, as proposed.
    PARSER_FIX = "parser_fix"  # A corrected confidence. Never a person's decision.


class Confidence(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ImportOutcome(str, enum.Enum):
    STORED = "stored"
    DUPLICATE = "duplicate"


class ImportItemState(str, enum.Enum):
    """What happened to one file of a batch. Reading and review are tracked on its document."""

    PENDING = "pending"  # Listed, and not yet received.
    STORED = "stored"
    DUPLICATE = "duplicate"  # These bytes were already in the archive.
    UNSUPPORTED = "unsupported"  # Not a PDF, or over the size limit. Never sent.
    REJECTED = "rejected"  # Arrived, but is not a readable PDF. Nothing was stored.
    INTERRUPTED = "interrupted"  # The upload stopped partway. Nothing was stored.


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
    # Names and birth dates printed under a patient label. Empty when the file could not be read.
    patient_found: Mapped[dict | None] = mapped_column(JSON)

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


class Observation(Base):
    """One laboratory result. These columns hold current values; revisions hold how they got here."""

    __tablename__ = "lab_observations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
    # Empty for a result typed in by hand with no document behind it.
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id"), index=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("extraction_runs.id"))
    origin: Mapped[ObservationOrigin] = mapped_column(_stored_as_value(ObservationOrigin), nullable=False)
    extraction_status: Mapped[ObservationExtraction] = mapped_column(_stored_as_value(ObservationExtraction), nullable=False)
    verification_status: Mapped[ObservationVerification] = mapped_column(_stored_as_value(ObservationVerification), nullable=False, default=ObservationVerification.PROPOSED, index=True)
    confidence: Mapped[Confidence | None] = mapped_column(_stored_as_value(Confidence))

    reported_name: Mapped[str] = mapped_column(String(200), nullable=False)  # Exactly as printed.
    test_code: Mapped[str | None] = mapped_column(String(32), index=True)
    code_system: Mapped[str | None] = mapped_column(String(32))
    value_text: Mapped[str] = mapped_column(String(60), nullable=False)  # Exactly as printed: "14.20", "<0.5".
    value_number: Mapped[float | None] = mapped_column(Float)  # Only when the value is one exact number.
    unit: Mapped[str | None] = mapped_column(String(40))  # Exactly as printed. Never assumed.
    normalized_value: Mapped[float | None] = mapped_column(Float)
    normalized_unit: Mapped[str | None] = mapped_column(String(40))
    reference_text: Mapped[str | None] = mapped_column(String(60))
    reference_low: Mapped[float | None] = mapped_column(Float)
    reference_high: Mapped[float | None] = mapped_column(Float)
    flag: Mapped[str | None] = mapped_column(String(12))  # As the laboratory printed it. Never computed.
    lab_name: Mapped[str | None] = mapped_column(String(255))

    # Four different moments. Any of the first three may be unknown, and none stands in for another.
    collected_on: Mapped[str | None] = mapped_column(String(10), index=True)  # When the specimen was taken.
    reported_on: Mapped[str | None] = mapped_column(String(10))  # The date on the laboratory's report.
    documented_on: Mapped[str | None] = mapped_column(String(10))  # When the result entered any record.
    imported_at: Mapped[str] = mapped_column(String(32), nullable=False)  # When it reached this archive.

    source_page: Mapped[int | None] = mapped_column(Integer)
    source_line: Mapped[int | None] = mapped_column(Integer)
    source_text: Mapped[str | None] = mapped_column(String(200))
    # Which collection on its report this came from, when the report tells several apart. Empty on older readings.
    source_section: Mapped[int | None] = mapped_column(Integer)
    issues: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # The group approval that accepted it, while that still stands. The history keeps it after that.
    approved_group_id: Mapped[str | None] = mapped_column(String(32), index=True)
    # The exact provider record version this was read from. Never changed once set.
    fhir_resource_id: Mapped[int | None] = mapped_column(ForeignKey("fhir_resources.id"), index=True)

    document: Mapped[Document | None] = relationship()
    revisions: Mapped[list["ObservationRevision"]] = relationship(back_populates="observation", order_by="ObservationRevision.id")


class ObservationRevision(Base):
    """Append-only. The first row is what was originally read or entered, and is never changed."""

    __tablename__ = "lab_observation_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observation_id: Mapped[str] = mapped_column(ForeignKey("lab_observations.id"), nullable=False, index=True)
    action: Mapped[RevisionAction] = mapped_column(_stored_as_value(RevisionAction), nullable=False)
    values: Mapped[dict] = mapped_column(JSON, nullable=False)
    occurred_at: Mapped[str] = mapped_column(String(32), nullable=False)
    review_group_id: Mapped[str | None] = mapped_column(String(32))  # Set when this was done as part of a group approval or its undoing.

    observation: Mapped[Observation] = relationship(back_populates="revisions")


class ReviewGroupApproval(Base):
    """A person approving one exact set of results together. Never removed: undoing it only records that it was undone."""

    __tablename__ = "review_group_approvals"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    group_key: Mapped[str] = mapped_column(String(80), nullable=False)
    collected_on: Mapped[str | None] = mapped_column(String(10))
    result_count: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_at: Mapped[str] = mapped_column(String(32), nullable=False)
    undone_at: Mapped[str | None] = mapped_column(String(32))


class ImportBatch(Base):
    """One folder or set of files a person chose. Lives here so the report outlasts the browser."""

    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ImportItem(Base):
    """One file of a batch. Changes in the same transaction as the document it produces."""

    __tablename__ = "import_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False)  # Display text, never used to open a file.
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    modified_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    state: Mapped[ImportItemState] = mapped_column(_stored_as_value(ImportItemState), nullable=False)
    message: Mapped[str | None] = mapped_column(String(300))
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id"), index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)

    document: Mapped[Document | None] = relationship()

    __table_args__ = (UniqueConstraint("batch_id", "path", name="uq_import_items_batch_path"), Index("ix_import_items_batch_state", "batch_id", "state"))


class IdentityProfile(Base):
    """One row at most. Compared with what documents print, only to raise a flag for a person to check."""

    __tablename__ = "identity_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    date_of_birth: Mapped[str | None] = mapped_column(String(10))
    previous_names: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)


class AuthCredential(Base):
    """One row at most: the salted hash of the passphrase. Not copied into backups."""

    __tablename__ = "auth_credential"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    salt: Mapped[str] = mapped_column(String(64), nullable=False)
    derived: Mapped[str] = mapped_column(String(128), nullable=False)
    n: Mapped[int] = mapped_column(Integer, nullable=False)
    r: Mapped[int] = mapped_column(Integer, nullable=False)
    p: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)


class AuthSession(Base):
    """A signed-in device. Only a hash of its token is kept. Not copied into backups."""

    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seen_at: Mapped[int] = mapped_column(Integer, nullable=False)


class ProviderConnection(Base):
    """One provider this archive may read from. Read-only: nothing is ever written back."""

    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
    provider_key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # connected, needs_sign_in, identity_hold, disconnected
    fhir_base: Mapped[str] = mapped_column(String(255), nullable=False)  # The address it was authorized for.
    patient_fhir_id: Mapped[str | None] = mapped_column(String(128))
    patient_name: Mapped[str | None] = mapped_column(String(200))
    patient_birth_date: Mapped[str | None] = mapped_column(String(10))
    identity_status: Mapped[str | None] = mapped_column(String(32))
    identity_reason: Mapped[str | None] = mapped_column(String(400))
    # Imports wait until this equals patient_fhir_id: the person said this provider's patient is them.
    confirmed_patient_fhir_id: Mapped[str | None] = mapped_column(String(128))
    scope: Mapped[str | None] = mapped_column(String(2000))
    # Tokens, encrypted with a key kept outside the database and outside backups.
    token_ciphertext: Mapped[str | None] = mapped_column(String(8000))
    # Moves on with every token write, sign-in and disconnect. A write expecting an older one is refused.
    token_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    connected_at: Mapped[str | None] = mapped_column(String(32))
    disconnected_at: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)

    runs: Mapped[list["SyncRun"]] = relationship(back_populates="connection", order_by="SyncRun.id")


class SyncRun(Base):
    """One manual synchronization. Counts and safe messages only, never record contents."""

    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    connection_id: Mapped[str] = mapped_column(ForeignKey("provider_connections.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # running, completed, partial, failed, interrupted
    started_at: Mapped[str] = mapped_column(String(32), nullable=False)
    finished_at: Mapped[str | None] = mapped_column(String(32))
    counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    problems: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    connection: Mapped[ProviderConnection] = relationship(back_populates="runs")


class FhirResource(Base):
    """One version of one provider record, exactly as received. A changed record adds a row; none is ever replaced."""

    __tablename__ = "fhir_resources"
    __table_args__ = (UniqueConstraint("connection_id", "resource_type", "fhir_id", "content_sha256"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    connection_id: Mapped[str] = mapped_column(ForeignKey("provider_connections.id"), nullable=False, index=True)
    sync_run_id: Mapped[int] = mapped_column(ForeignKey("sync_runs.id"), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(40), nullable=False)
    fhir_id: Mapped[str] = mapped_column(String(128), nullable=False)
    version_id: Mapped[str | None] = mapped_column(String(64))
    last_updated: Mapped[str | None] = mapped_column(String(40))  # The provider's own change time.
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    body: Mapped[dict] = mapped_column(JSON, nullable=False)
    fetched_at: Mapped[str] = mapped_column(String(32), nullable=False)  # When this archive received it. Not a clinical date.
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id"))  # A PDF attachment stored as a document.

