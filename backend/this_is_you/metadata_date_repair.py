"""Clears the warning that a document's date could be read two ways, now that numeric dates are read month first.

Older readings lowered confidence for this alone. Only that sentence goes: a date with no label, several different dates
or a two-digit year is still a reason for doubt. Proposals have no history of their own, so nothing is edited. A corrected
proposal is added after the old one in the same reading, the last for a field is the current one, and the old row stays as
the record. Reads stored text only, never a PDF. Approves nothing, and leaves alone any field a person has decided.
"""
from __future__ import annotations

import logging
import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import selectinload, sessionmaker

from .extraction.rules import find_dates
from .lab_confidence_repair import Report
from .models import Confidence, Document, ExtractionRun, MetadataField, MetadataProposal

log = logging.getLogger("this_is_you.metadata_date_repair")  # Counts only.

_DOUBT = re.compile(r"^(.*) The numbers could be read two ways: (\d{4}-\d{2}-\d{2}) or (\d{4}-\d{2}-\d{2})\.$", re.S)
# What each kind of reason was worth before the penalty, as in rules.propose_service_date.
_LEVEL_BY_REASON = (
    (re.compile(r'^Labeled ".*" in the document\.$', re.S), Confidence.HIGH),
    (re.compile(r"^Found \d+ different dates labeled "), Confidence.LOW),
    (re.compile(r"^The only date on the first page, "), Confidence.LOW),
)


def _level(reason: str) -> Confidence | None:
    return next((level for pattern, level in _LEVEL_BY_REASON if pattern.match(reason)), None)


def _why_it_stays(document: Document, proposal: MetadataProposal, current: MetadataProposal | None, today: date) -> str | None:
    if proposal is not current:
        return "not_the_current_reading"  # An older reading, kept as the record and shown nowhere.
    if any(d.field is proposal.field for d in document.decisions):
        return "already_decided"
    doubt = _DOUBT.match(proposal.reason)
    if proposal.field is not MetadataField.SERVICE_DATE or proposal.confidence is not Confidence.LOW or not doubt or doubt[2] != proposal.value:
        return "not_the_expected_warning"
    if _level(doubt[1]) is None:
        return "unknown_reason"
    found = [f for f in find_dates(proposal.source_snippet, today) if f.iso == proposal.value and f.ambiguous == doubt[3]]
    if not found:
        return "stored_line_does_not_confirm_it"
    # The old check for two readings came first and hid this one, and it is still a real doubt.
    if any(f.two_digit_year for f in found):
        return "two_digit_year"
    return None


def repair_metadata_date_doubt(sessions: sessionmaker, apply: bool = False, today: date | None = None) -> Report:
    """Without apply, only counts. With it, every correction lands together or none does."""
    with sessions() as session:
        if apply:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        report, safe = Report(), []
        documents = session.scalars(select(Document).options(selectinload(Document.runs).selectinload(ExtractionRun.proposals), selectinload(Document.decisions))).all()
        for document in documents:
            latest = document.runs[-1] if document.runs else None
            current = {p.field: p for p in latest.proposals} if latest else {}
            for run in document.runs:
                for proposal in run.proposals:
                    if " could be read two ways: " not in proposal.reason:
                        continue
                    report.candidates += 1
                    reason = _why_it_stays(document, proposal, current.get(proposal.field), today or date.today())
                    if reason:
                        report.uncertain[reason] += 1
                    else:
                        level = _level(_DOUBT.match(proposal.reason)[1])
                        report.safe[level.value] += 1
                        safe.append((proposal, level))
        if not apply:
            return report
        for proposal, level in safe:
            session.add(MetadataProposal(run_id=proposal.run_id, field=proposal.field, value=proposal.value, confidence=level, reason=_DOUBT.match(proposal.reason)[1], source_page=proposal.source_page, source_snippet=proposal.source_snippet))
        session.commit()
    log.info("metadata date repair: %d corrected, %d left", sum(report.safe.values()), sum(report.uncertain.values()))
    return report
