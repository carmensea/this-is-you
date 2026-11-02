"""The JSON the frontend reads. Storage paths are deliberately absent."""
from __future__ import annotations

from pydantic import BaseModel

from .metadata import FIELDS, current_decisions, current_proposals
from .lab_catalog import BY_CODE, canonical_unit
from .models import Document, MetadataDecision, MetadataProposal, Observation, RevisionAction


class ProposalOut(BaseModel):
    id: int
    value: str
    confidence: str
    reason: str
    page: int
    snippet: str
    method: str

    @classmethod
    def of(cls, p: MetadataProposal, method: str) -> "ProposalOut":
        return cls(id=p.id, value=p.value, confidence=p.confidence.value, reason=p.reason, page=p.source_page, snippet=p.source_snippet, method=method)


class FieldOut(BaseModel):
    """`value` holds only what a person decided. An inferred value appears only under `proposal`."""

    state: str  # missing, proposed, confirmed, corrected or not_stated
    value: str | None
    decided_at: str | None
    proposal: ProposalOut | None


class DocumentOut(BaseModel):
    id: str
    original_filename: str
    imported_at: str
    media_type: str
    byte_size: int
    sha256: str
    content_url: str
    extraction_status: str
    review_status: str
    verification_status: str
    page_count: int | None
    pages_read: int
    pages_with_text: int
    truncated: bool
    metadata: dict[str, FieldOut]
    possible_duplicates: list[str]

    @classmethod
    def of(cls, d: Document, duplicates: dict[str, list[str]] | None = None) -> "DocumentOut":
        proposals, decisions = current_proposals(d), current_decisions(d)
        method = d.runs[-1].method if d.runs else ""
        fields: dict[str, FieldOut] = {}
        for field in FIELDS:
            proposal, decision = proposals.get(field), decisions.get(field)
            fields[field.value] = FieldOut(
                state=decision.action.value if decision else "proposed" if proposal else "missing",
                value=decision.value if decision else None,
                decided_at=decision.decided_at if decision else None,
                proposal=ProposalOut.of(proposal, method) if proposal else None,
            )
        run = d.runs[-1] if d.runs else None
        return cls(
            id=d.id, original_filename=d.original_filename, imported_at=d.imported_at, media_type=d.media_type, byte_size=d.byte_size, sha256=d.sha256,
            content_url=f"/api/documents/{d.id}/content", extraction_status=d.extraction_status.value, review_status=d.review_status.value,
            verification_status=d.verification_status.value, page_count=run.page_count if run else None, pages_read=run.pages_read if run else 0,
            pages_with_text=run.pages_with_text if run else 0, truncated=run.truncated if run else False, metadata=fields,
            possible_duplicates=(duplicates or {}).get(d.id, []),
        )


class RevisionOut(BaseModel):
    action: str
    values: dict
    occurred_at: str


class ObservationOut(BaseModel):
    id: str
    document_id: str | None
    origin: str
    extraction_status: str
    verification_status: str
    confidence: str | None
    reported_name: str
    test_code: str | None
    code_system: str | None
    test_name: str | None
    test_short: str | None
    category: str
    compare_group: str | None
    value_text: str
    value_number: float | None
    unit: str | None
    display_unit: str | None
    normalized_value: float | None
    normalized_unit: str | None
    reference_text: str | None
    reference_low: float | None
    reference_high: float | None
    flag: str | None
    lab_name: str | None
    collected_on: str | None
    reported_on: str | None
    documented_on: str | None
    imported_at: str
    source_page: int | None
    source_line: int | None
    source_text: str | None
    issues: list[str]
    edited: bool
    original: dict
    possible_duplicates: list[str]
    revisions: list[RevisionOut]

    @classmethod
    def of(cls, o: Observation, duplicates: dict[str, list[str]] | None = None) -> "ObservationOut":
        test = BY_CODE.get(o.test_code or "")
        return cls(
            id=o.id, document_id=o.document_id, origin=o.origin.value, extraction_status=o.extraction_status.value, verification_status=o.verification_status.value,
            confidence=o.confidence.value if o.confidence else None, reported_name=o.reported_name, test_code=o.test_code, code_system=o.code_system,
            test_name=test.name if test else None, test_short=test.short if test else None, category=test.category if test else "other", compare_group=test.compare_group if test else None,
            value_text=o.value_text, value_number=o.value_number, unit=o.unit, display_unit=canonical_unit(o.unit), normalized_value=o.normalized_value, normalized_unit=o.normalized_unit,
            reference_text=o.reference_text, reference_low=o.reference_low, reference_high=o.reference_high, flag=o.flag, lab_name=o.lab_name,
            collected_on=o.collected_on, reported_on=o.reported_on, documented_on=o.documented_on, imported_at=o.imported_at,
            source_page=o.source_page, source_line=o.source_line, source_text=o.source_text, issues=o.issues,
            edited=any(r.action is RevisionAction.CORRECTED for r in o.revisions), original=o.revisions[0].values if o.revisions else {},
            possible_duplicates=(duplicates or {}).get(o.id, []),
            revisions=[RevisionOut(action=r.action.value, values=r.values, occurred_at=r.occurred_at) for r in o.revisions],
        )


class ObservationList(BaseModel):
    observations: list[ObservationOut]


class LabTestOut(BaseModel):
    code: str
    name: str
    short: str
    unit: str


class ImportEventOut(BaseModel):
    submitted_filename: str
    outcome: str
    occurred_at: str


class DecisionOut(BaseModel):
    field: str
    action: str
    value: str | None
    decided_at: str
    proposed_value: str | None

    @classmethod
    def of(cls, d: MetadataDecision) -> "DecisionOut":
        return cls(field=d.field.value, action=d.action.value, value=d.value, decided_at=d.decided_at, proposed_value=d.proposal.value if d.proposal else None)


class RunOut(BaseModel):
    method: str
    status: str
    finished_at: str
    page_count: int | None
    pages_read: int


class DocumentDetail(DocumentOut):
    imports: list[ImportEventOut]
    decisions: list[DecisionOut]
    runs: list[RunOut]


class DocumentList(BaseModel):
    documents: list[DocumentOut]


class UploadResult(BaseModel):
    duplicate: bool
    document: DocumentOut


class Status(BaseModel):
    status: str
    max_upload_bytes: int

