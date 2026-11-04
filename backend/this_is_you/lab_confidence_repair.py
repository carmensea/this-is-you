"""Corrects results marked low confidence only by a parser bug. Approves nothing, and changes nothing else.

The bug: a row read before its collection date was marked low confidence for having no date. When the date
turned up later, the warning was removed and the mark stayed. Every other route to low confidence leaves a
warning on the row, in rules-v3 and rules-v4 alike, so a low result with no warning, unchanged since it was
read, can only have come from this. Anything that cannot be shown to fit is left for individual review.
"""
from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .extraction.lab_rows import parse_lab_rows
from .models import Confidence, ExtractionRun, Observation, ObservationExtraction, ObservationOrigin, ObservationRevision, ObservationVerification, RevisionAction
from .observations import _now, _snapshot

log = logging.getLogger("this_is_you.lab_confidence_repair")  # Counts only.

_METHODS_WITH_BUG = {"rules-v3", "rules-v4"}
_REASON = "A collection date found after the table cleared its warning but not the confidence penalty."
_ANY_DATE = "Collected on Mar 5, 2024 9:12 AM"  # Only so the stored line is read with its date already known.
_TABLE_HEADING = "Component Your Value Standard Range Flag"


@dataclass
class Report:
    candidates: int = 0
    safe: Counter = field(default_factory=Counter)
    uncertain: Counter = field(default_factory=Counter)


def _confidence_with_date_known(o: Observation, today: date) -> str | None:
    """Reads the stored source line again, not the PDF. The row must come out the same, with nothing to warn about."""
    parts = (o.source_text or "").split(" | ")
    for lines in ([_ANY_DATE, *parts], [_ANY_DATE, _TABLE_HEADING, *parts]):
        found = parse_lab_rows([(1, "\n".join(lines))], today)
        if len(found) == 1:
            r = found[0]
            if (r.name, r.value, r.unit, r.reference, r.flag) == (o.reported_name, o.value_text, o.unit, o.reference_text, o.flag) and not r.issues:
                return r.confidence
    return None


def _position(o: Observation) -> tuple[int, int]:
    return (o.source_page or 0, o.source_line or 0)


def _why_uncertain(o: Observation, method: str | None, same_run: list[Observation]) -> str | None:
    if o.origin is not ObservationOrigin.EXTRACTED or o.extraction_status is not ObservationExtraction.PARSED:
        return "not_a_clean_reading"
    if o.verification_status is not ObservationVerification.PROPOSED:
        return "already_decided"
    if [r.action for r in o.revisions] != [RevisionAction.EXTRACTED]:
        return "changed_since_reading"
    if method not in _METHODS_WITH_BUG:
        return "unknown_parser_version"
    # The late date only applied when one date covered the whole report, so every row of the reading has it.
    if {other.collected_on for other in same_run} != {o.collected_on} or not o.collected_on:
        return "not_one_collection_date"
    # A row after the date line took no penalty, so one before this result means the date came too early for the bug.
    if any(other.confidence is not Confidence.LOW and _position(other) < _position(o) for other in same_run):
        return "date_came_before_this_row"
    return None


def _assess(session: Session, today: date) -> tuple[Report, list[tuple[Observation, str]]]:
    everything = session.scalars(select(Observation).options(selectinload(Observation.revisions))).all()
    methods = dict(session.execute(select(ExtractionRun.id, ExtractionRun.method)).all())
    by_run = defaultdict(list)
    for o in everything:
        by_run[o.run_id].append(o)
    report, safe = Report(), []
    for o in everything:
        if o.confidence is not Confidence.LOW or o.issues:
            continue
        report.candidates += 1
        reason = _why_uncertain(o, methods.get(o.run_id), by_run[o.run_id])
        level = None if reason else _confidence_with_date_known(o, today)
        if reason is None and level not in ("high", "medium"):
            reason = "source_line_does_not_confirm_it"
        if reason:
            report.uncertain[reason] += 1
        else:
            report.safe[level] += 1
            safe.append((o, level))
    return report, safe


def repair(sessions: sessionmaker[Session], apply: bool = False, today: date | None = None) -> Report:
    """Without apply, only counts. With it, every correction lands together or none does."""
    with sessions() as session:
        if apply:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        report, safe = _assess(session, today or date.today())
        if not apply:
            return report
        at = _now()
        for o, level in safe:
            o.confidence = Confidence(level)
            values = {**_snapshot(o), "parser_fix": {"previous_confidence": "low", "new_confidence": level, "reason": _REASON, "recorded_as": "A parser bug fix, not a person's verification."}}
            session.add(ObservationRevision(observation=o, action=RevisionAction.PARSER_FIX, values=values, occurred_at=at))
        session.commit()
    log.info("lab confidence repair: %d corrected, %d left", sum(report.safe.values()), sum(report.uncertain.values()))
    return report


# ---- Dates are read month first, so a warning that a date could be read two ways no longer applies.

_DATE_DOUBT = re.compile(r"^This date could be read two ways: (\d{4}-\d{2}-\d{2}) or ")
_DATE_RULE_REASON = "Numeric dates are read month first, so this date is not in doubt. The date itself did not change."


def _date_doubts(o: Observation) -> list[str]:
    return [issue for issue in o.issues or [] if _DATE_DOUBT.match(issue)]


def _why_date_doubt_stays(o: Observation) -> str | None:
    # A reading with any warning is stored as ambiguous.
    if o.origin is not ObservationOrigin.EXTRACTED or o.extraction_status is not ObservationExtraction.AMBIGUOUS:
        return "not_a_clean_reading"
    if o.verification_status is not ObservationVerification.PROPOSED:
        return "already_decided"
    if [r.action for r in o.revisions] != [RevisionAction.EXTRACTED]:
        return "changed_since_reading"
    if any(_DATE_DOUBT.match(issue)[1] != o.collected_on for issue in _date_doubts(o)):
        return "stored_date_is_not_the_month_first_reading"
    return None


def repair_date_doubt(sessions: sessionmaker[Session], apply: bool = False, today: date | None = None) -> Report:
    """Without apply, only counts. With it, every correction lands together or none does. Approves nothing."""
    with sessions() as session:
        if apply:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        report, safe = Report(), []
        for o in session.scalars(select(Observation).options(selectinload(Observation.revisions))).all():
            if not _date_doubts(o):
                continue
            report.candidates += 1
            others = [issue for issue in o.issues if not _DATE_DOUBT.match(issue)]
            reason = _why_date_doubt_stays(o)
            # Other warnings keep it low. With none left, the stored line has to confirm what it should have been.
            level = "low" if others else (None if reason else _confidence_with_date_known(o, today or date.today()))
            if reason is None and level is None:
                reason = "source_line_does_not_confirm_it"
            if reason:
                report.uncertain[reason] += 1
            else:
                report.safe[level] += 1
                safe.append((o, level, others))
        if not apply:
            return report
        at = _now()
        for o, level, others in safe:
            removed, previous = _date_doubts(o), o.confidence.value
            o.issues, o.confidence = others, Confidence(level)
            if not others:
                o.extraction_status = ObservationExtraction.PARSED  # What a fresh reading stores with no warnings.
            values = {**_snapshot(o), "parser_fix": {"previous_confidence": previous, "new_confidence": level, "removed_warnings": removed, "reason": _DATE_RULE_REASON, "recorded_as": "A parser rule change, not a person's verification."}}
            session.add(ObservationRevision(observation=o, action=RevisionAction.PARSER_FIX, values=values, occurred_at=at))
        session.commit()
    log.info("date warning repair: %d corrected, %d left", sum(report.safe.values()), sum(report.uncertain.values()))
    return report
