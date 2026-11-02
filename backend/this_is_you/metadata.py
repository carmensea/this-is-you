"""Running the reader, recording proposals, and recording what a person decides.

The one rule this module exists to keep: inference never becomes verified information. Only a
MetadataDecision can make a field verified, and only an API request from the person can create one.
"""
from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from .documents import utc_now
from .extraction import METHOD
from .extraction.runner import ExtractionResult, Limits, extract
from .models import (
    Confidence,
    DecisionAction,
    Document,
    DocumentType,
    ExtractionRun,
    ExtractionStatus,
    MetadataDecision,
    MetadataField,
    MetadataProposal,
    ReviewStatus,
    VerificationStatus,
)
from .storage import OriginalStore, UploadRejected

log = logging.getLogger("this_is_you.extraction")

FIELDS = list(MetadataField)
UNFINISHED = (ExtractionStatus.PENDING, ExtractionStatus.RUNNING)


def conflict(code: str, message: str) -> UploadRejected:
    return UploadRejected(409, code, message)


def invalid(message: str) -> UploadRejected:
    return UploadRejected(422, "invalid_value", message)


# ---- Reading

def record_result(session: Session, document: Document, result: ExtractionResult) -> None:
    run = ExtractionRun(
        document_id=document.id, method=METHOD, status=ExtractionStatus(result.status), finished_at=utc_now(), page_count=result.page_count,
        pages_read=result.pages_read, pages_with_text=result.pages_with_text, pages_failed=result.pages_failed, truncated=result.truncated, text_sha256=result.text_sha256,
    )
    for p in result.proposals:
        run.proposals.append(MetadataProposal(field=MetadataField(p["field"]), value=p["value"], confidence=Confidence(p["confidence"]), reason=p["reason"], source_page=p["page"], source_snippet=p["snippet"]))
    session.add(run)
    document.extraction_status = run.status


def process_document(sessions: sessionmaker[Session], store: OriginalStore, limits: Limits, document_id: str) -> None:
    with sessions() as session:
        document = session.get(Document, document_id)
        if document is None or document.extraction_status not in UNFINISHED:
            return
        document.extraction_status = ExtractionStatus.RUNNING
        key = document.storage_key
        session.commit()
    path = store.path_for(key)
    result = extract(path, limits) if path.is_file() else ExtractionResult("failed")
    with sessions() as session:
        document = session.get(Document, document_id)
        assert document is not None
        record_result(session, document, result)
        session.commit()
    log.info("document %s: extraction %s, %d proposals", document_id, result.status, len(result.proposals))


def documents_to_resume(sessions: sessionmaker[Session]) -> list[str]:
    """After a restart: anything interrupted mid-read goes back in the queue."""
    with sessions() as session:
        session.execute(update(Document).where(Document.extraction_status == ExtractionStatus.RUNNING).values(extraction_status=ExtractionStatus.PENDING))
        session.commit()
        return list(session.scalars(select(Document.id).where(Document.extraction_status == ExtractionStatus.PENDING)))


def request_reread(sessions: sessionmaker[Session], document_id: str) -> None:
    with sessions() as session:
        document = session.get(Document, document_id)
        if document is None:
            raise UploadRejected(404, "not_found", "No such document.")
        if document.extraction_status in UNFINISHED:
            raise conflict("already_reading", "This document is already being read.")
        document.extraction_status = ExtractionStatus.PENDING
        session.commit()


# ---- Looking things up

def current_proposals(document: Document) -> dict[MetadataField, MetadataProposal]:
    if not document.runs:
        return {}
    return {p.field: p for p in document.runs[-1].proposals}


def current_decisions(document: Document) -> dict[MetadataField, MetadataDecision]:
    return {d.field: d for d in document.decisions}  # Ordered by id, so the latest wins.


def possible_duplicates(sessions: sessionmaker[Session]) -> dict[str, list[str]]:
    """Documents whose text matches, though their bytes differ: the same report saved twice, perhaps."""
    with sessions() as session:
        latest = dict(session.execute(select(ExtractionRun.document_id, ExtractionRun.text_sha256).order_by(ExtractionRun.id)).all())
    groups: dict[str, list[str]] = {}
    for document_id, text_hash in latest.items():
        if text_hash:
            groups.setdefault(text_hash, []).append(document_id)
    return {doc: [other for other in group if other != doc] for group in groups.values() if len(group) > 1 for doc in group}


# ---- Decisions

def clean_value(field: MetadataField, raw: str | None) -> str:
    if raw is None:
        raise invalid("A value is required.")
    value = unicodedata.normalize("NFC", "".join(c for c in raw if unicodedata.category(c)[0] != "C")).strip()
    if not value:
        raise invalid("A value is required.")
    if field is MetadataField.DOCUMENT_TYPE:
        if value not in {t.value for t in DocumentType}:
            raise invalid("Unknown document type.")
    elif field is MetadataField.SERVICE_DATE:
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise invalid("Use a date in the form YYYY-MM-DD.") from None
        if not date(1900, 1, 1) <= parsed <= date.today() + timedelta(days=1):
            raise invalid("The date must be between 1900 and today.")
        value = parsed.isoformat()
    elif len(value) > 255:
        raise invalid("This is too long: 255 characters at most.")
    return value


def _refresh_statuses(document: Document, decisions: dict[MetadataField, MetadataDecision]) -> None:
    checked = sum(d.action in (DecisionAction.CONFIRMED, DecisionAction.CORRECTED) for d in decisions.values())
    document.verification_status = (
        VerificationStatus.VERIFIED if checked == len(FIELDS) else VerificationStatus.PARTIALLY_VERIFIED if checked else VerificationStatus.UNVERIFIED
    )


@dataclass(frozen=True)
class DecisionRequest:
    action: DecisionAction
    value: str | None = None
    proposal_id: int | None = None


def decide(sessions: sessionmaker[Session], document_id: str, field: MetadataField, request: DecisionRequest) -> None:
    with sessions() as session:
        document = session.get(Document, document_id)
        if document is None:
            raise UploadRejected(404, "not_found", "No such document.")
        proposal = current_proposals(document).get(field)
        if request.action is DecisionAction.CONFIRMED:
            # Must name the proposal the person was looking at. A newer reading might say something else.
            if proposal is None or request.proposal_id != proposal.id:
                raise conflict("stale_proposal", "This proposal has changed. Check the new value before confirming.")
            value, action = proposal.value, DecisionAction.CONFIRMED
        elif request.action is DecisionAction.CORRECTED:
            value = clean_value(field, request.value)
            action = DecisionAction.CONFIRMED if proposal is not None and proposal.value == value else DecisionAction.CORRECTED
        else:
            value, action = None, DecisionAction.NOT_STATED
        session.add(MetadataDecision(document_id=document_id, field=field, action=action, value=value, proposal_id=proposal.id if proposal else None, decided_at=utc_now()))
        session.flush()
        session.refresh(document, ["decisions"])
        _refresh_statuses(document, current_decisions(document))
        # Changing anything reopens a finished review: "reviewed" has to mean the current values.
        document.review_status = ReviewStatus.IN_PROGRESS
        session.commit()
    log.info("document %s: decision recorded", document_id)


def set_review(sessions: sessionmaker[Session], document_id: str, complete: bool) -> None:
    with sessions() as session:
        document = session.get(Document, document_id)
        if document is None:
            raise UploadRejected(404, "not_found", "No such document.")
        if complete:
            missing = [f for f in FIELDS if f not in current_decisions(document)]
            if missing:
                raise conflict("undecided_fields", f"{len(missing)} of {len(FIELDS)} details still need a decision.")
            document.review_status = ReviewStatus.COMPLETED
        else:
            document.review_status = ReviewStatus.IN_PROGRESS
        session.commit()
