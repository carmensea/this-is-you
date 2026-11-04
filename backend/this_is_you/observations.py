"""Laboratory observations: creating, correcting and approving them.

Nothing reaches a chart unless a person approved it. Every change appends a revision holding all the
values, so what was first read and each correction since can always be shown.
"""
from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .lab_catalog import BY_CODE, CATEGORIES, CODE_SYSTEM, canonical_unit, find_test, normalize, parse_range, parse_value
from .models import (
    Confidence,
    Document,
    Observation,
    ObservationExtraction,
    ObservationOrigin,
    ObservationRevision,
    ObservationVerification,
    ReviewGroupApproval,
    RevisionAction,
)
from .storage import UploadRejected

log = logging.getLogger("this_is_you.observations")

EDITABLE = ("reported_name", "value_text", "unit", "reference_text", "flag", "lab_name", "collected_on", "reported_on", "documented_on")
_LIMITS = {"reported_name": 200, "value_text": 60, "unit": 40, "reference_text": 60, "flag": 12, "lab_name": 255}
_DATES = ("collected_on", "reported_on", "documented_on")
_RECORDED = (*EDITABLE, "test_code", "value_number", "normalized_value", "normalized_unit", "reference_low", "reference_high", "verification_status")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _invalid(message: str) -> UploadRejected:
    return UploadRejected(422, "invalid_value", message)


def _not_found() -> UploadRejected:
    return UploadRejected(404, "not_found", "No such measurement.")


def _clean_text(field: str, raw: object) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise _invalid(f"{field} must be text.")
    text = unicodedata.normalize("NFC", "".join(c for c in raw if unicodedata.category(c)[0] != "C")).strip()
    if len(text) > _LIMITS[field]:
        raise _invalid(f"This is too long: {_LIMITS[field]} characters at most.")
    return text or None


def _clean_date(raw: object) -> str | None:
    if raw is None or raw == "":
        return None
    try:
        parsed = date.fromisoformat(str(raw))
    except ValueError:
        raise _invalid("Use a date in the form YYYY-MM-DD.") from None
    if not date(1900, 1, 1) <= parsed <= date.today() + timedelta(days=1):
        raise _invalid("The date must be between 1900 and today.")
    return parsed.isoformat()


def clean_fields(fields: dict) -> dict:
    unknown = set(fields) - set(EDITABLE)
    if unknown:
        raise _invalid("This request has fields that cannot be edited.")
    return {k: _clean_date(v) if k in _DATES else _clean_text(k, v) for k, v in fields.items()}


def _derive(o: Observation) -> None:
    """Everything calculated from what is printed. Recalculated on each change, never edited directly."""
    test = find_test(o.reported_name, o.unit)
    o.test_code, o.code_system = (test.code, CODE_SYSTEM) if test else (None, None)
    o.value_number = parse_value(o.value_text)
    o.reference_low, o.reference_high = parse_range(o.reference_text)
    o.normalized_value, o.normalized_unit = normalize(test, o.value_number, o.unit)


def _person_issues(o: Observation) -> list[str]:
    """What still deserves a look after a person has edited a row."""
    issues = []
    test = find_test(o.reported_name, o.unit)
    if not o.unit:
        issues.append("No unit recorded.")
    elif test and canonical_unit(o.unit) not in test.expected_units:
        issues.append(f"The unit {o.unit} is unusual for {test.short}.")
    if not o.collected_on:
        issues.append("No collection date recorded, so this will not be graphed.")
    if o.value_number is None:
        issues.append("Not an exact number, so this will not be graphed.")
    if o.collected_on and o.reported_on and o.reported_on < o.collected_on:
        issues.append("The report date is before the collection date.")
    if o.collected_on and o.documented_on and o.documented_on < o.collected_on:
        issues.append("The documented date is before the collection date.")
    return issues


def _snapshot(o: Observation) -> dict:
    return {k: (getattr(o, k).value if k == "verification_status" else getattr(o, k)) for k in _RECORDED}


def _revise(session: Session, o: Observation, action: RevisionAction, group_id: str | None = None, at: str | None = None) -> None:
    session.add(ObservationRevision(observation=o, action=action, values=_snapshot(o), occurred_at=at or _now(), review_group_id=group_id))


def add_extracted_rows(session: Session, document: Document, run_id: int, rows: list[dict]) -> None:
    """Adds what a reading found. Rows already known stay as they are, including rejected ones."""
    existing = session.scalars(select(Observation).where(Observation.document_id == document.id, Observation.origin == ObservationOrigin.EXTRACTED)).all()
    # Without the line: a newer reading can number the lines of a page differently, and the same result should not appear twice.
    known = {(o.revisions[0].values["reported_name"], o.revisions[0].values["value_text"], o.source_page) for o in existing if o.revisions}
    seen = set()
    for row in rows:
        if (row["name"], row["value"], row["page"]) in known or (row["name"], row["value"], row["page"], row["line"]) in seen:
            continue
        seen.add((row["name"], row["value"], row["page"], row["line"]))
        o = Observation(
            document_id=document.id, run_id=run_id, origin=ObservationOrigin.EXTRACTED,
            extraction_status=ObservationExtraction.AMBIGUOUS if row["issues"] else ObservationExtraction.PARSED,
            verification_status=ObservationVerification.PROPOSED, confidence=Confidence(row["confidence"]),
            reported_name=row["name"], value_text=row["value"], unit=row["unit"], reference_text=row["reference"], flag=row["flag"],
            collected_on=row["collected"], reported_on=row["reported"],
            # A report date is when the result was documented. With none printed, that date stays unknown.
            documented_on=row["reported"], imported_at=document.imported_at,
            source_page=row["page"], source_line=row["line"], source_text=row["source"], source_section=row.get("section"), issues=row["issues"],
        )
        _derive(o)
        session.add(o)
        _revise(session, o, RevisionAction.EXTRACTED)


def unresolved_count(session: Session, document_id: str) -> int:
    return len(session.scalars(select(Observation.id).where(Observation.document_id == document_id, Observation.verification_status == ObservationVerification.PROPOSED)).all())


_FULL = (selectinload(Observation.revisions),)


def list_observations(sessions: sessionmaker[Session]) -> list[Observation]:
    with sessions() as session:
        return list(session.scalars(select(Observation).options(*_FULL).order_by(Observation.collected_on, Observation.id)))


def get_observation(sessions: sessionmaker[Session], observation_id: str) -> Observation:
    with sessions() as session:
        found = session.scalars(select(Observation).options(*_FULL).where(Observation.id == observation_id)).one_or_none()
    if found is None:
        raise _not_found()
    return found


def possible_duplicates(observations: list[Observation]) -> dict[str, list[str]]:
    """Results that say the same thing: same test, same date, same value, same unit. Not merged."""
    groups: dict[tuple, list[str]] = {}
    for o in observations:
        if o.verification_status is ObservationVerification.REJECTED or not o.collected_on:
            continue
        name = o.test_code or " ".join(o.reported_name.lower().split())
        groups.setdefault((name, o.collected_on, o.value_text, canonical_unit(o.unit)), []).append(o.id)
    return {i: [other for other in group if other != i] for group in groups.values() if len(group) > 1 for i in group}


@dataclass(frozen=True)
class ManualEntry:
    fields: dict
    document_id: str | None
    verify: bool


def create_manual(sessions: sessionmaker[Session], entry: ManualEntry) -> str:
    fields = clean_fields(entry.fields)
    if not fields.get("reported_name"):
        raise _invalid("A test name is required.")
    if not fields.get("value_text"):
        raise _invalid("A value is required.")
    with sessions() as session:
        if entry.document_id is not None and session.get(Document, entry.document_id) is None:
            raise _invalid("That source document does not exist.")
        o = Observation(document_id=entry.document_id, origin=ObservationOrigin.MANUAL, extraction_status=ObservationExtraction.NOT_EXTRACTED, verification_status=ObservationVerification.PROPOSED, imported_at=_now(), **fields)
        o.issues = _person_issues(o)
        _derive(o)
        session.add(o)
        _revise(session, o, RevisionAction.ENTERED)
        if entry.verify:
            o.verification_status = ObservationVerification.VERIFIED
            _revise(session, o, RevisionAction.VERIFIED)
        session.commit()
        new_id = o.id
    log.info("measurement %s: entered by hand", new_id)
    return new_id


def correct(sessions: sessionmaker[Session], observation_id: str, raw_fields: dict) -> None:
    """Applies a person's edit. An edited result needs approving again before it can be shown."""
    fields = clean_fields(raw_fields)
    if "reported_name" in fields and not fields["reported_name"]:
        raise _invalid("A test name is required.")
    if "value_text" in fields and not fields["value_text"]:
        raise _invalid("A value is required.")
    with sessions() as session:
        # The lock comes before the read. Otherwise an approval landing in between would stand, over a value nobody saw.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        o = session.get(Observation, observation_id)
        if o is None:
            raise _not_found()
        if all(getattr(o, k) == v for k, v in fields.items()):
            return
        for k, v in fields.items():
            setattr(o, k, v)
        _derive(o)
        o.issues = _person_issues(o)
        o.confidence = None  # A person's value has no machine confidence.
        o.verification_status = ObservationVerification.PROPOSED
        o.approved_group_id = None
        _revise(session, o, RevisionAction.CORRECTED)
        session.commit()
    log.info("measurement %s: corrected", observation_id)


_TRANSITIONS = {
    RevisionAction.VERIFIED: ObservationVerification.VERIFIED,
    RevisionAction.REJECTED: ObservationVerification.REJECTED,
    RevisionAction.REOPENED: ObservationVerification.PROPOSED,
}


def set_status(sessions: sessionmaker[Session], observation_ids: list[str], action: RevisionAction) -> None:
    """A person deciding on individual results. Approving several together goes through approve_group."""
    with sessions() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        found = session.scalars(select(Observation).where(Observation.id.in_(observation_ids))).all()
        if len(found) != len(set(observation_ids)):
            raise _not_found()
        if action is RevisionAction.VERIFIED and any(not o.value_text for o in found):
            raise _invalid("One of these has no value yet. Enter it from the original before approving.")
        for o in found:
            if o.verification_status is not _TRANSITIONS[action]:
                o.verification_status = _TRANSITIONS[action]
                o.approved_group_id = None
                _revise(session, o, action)
        session.commit()
    log.info("%d measurements: %s", len(found), action.value)


# ---- Review groups: a person checks a table of clean results against the original, then approves exactly that set.

_CATEGORY_NAMES = {code: name for code, name, _short in CATEGORIES}


@dataclass(frozen=True)
class GroupInfo:
    key: str | None
    label: str
    eligible: bool
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class GroupItem:
    id: str
    version: int


def _category(o: Observation) -> str:
    test = BY_CODE.get(o.test_code or "")
    return test.category if test else "other"


def _group_key(o: Observation) -> str:
    # Not a claim that this is one clinical panel: only one document, one collection and one kind of test.
    return f"{o.collected_on or 'undated'}|{_category(o)}|{o.source_section or 0}"


def _reasons(o: Observation, repeated: bool) -> list[str]:
    """Why this result needs looking at alone. Empty means it is complete, so a person can check it in a table."""
    reasons = list(o.issues or [])
    if o.confidence is Confidence.LOW and not reasons:
        reasons.append("The reader was not confident about this row.")
    if not o.source_page:
        reasons.append("It has no source line in this document to check it against.")
    if not o.test_code:
        reasons.append("This test is not in the known list.")
    if o.value_number is None:
        reasons.append("Its value is not one exact number.")
    if not o.unit:
        reasons.append("No unit is recorded.")
    if not o.reference_text:
        reasons.append("No reference range is recorded.")
    if not o.collected_on:
        reasons.append("No collection date is recorded.")
    if repeated:
        reasons.append("This test appears more than once for this date, which could mean separate collections.")
    return list(dict.fromkeys(reasons))


def review_groups(observations: list[Observation]) -> dict[str, GroupInfo]:
    """Worked out each time from the results themselves, so nothing about a group can go out of date."""
    per_test: dict[tuple, int] = {}
    for o in observations:
        if o.document_id and o.verification_status is not ObservationVerification.REJECTED and o.test_code:
            test_key = (o.document_id, _group_key(o), o.test_code)
            per_test[test_key] = per_test.get(test_key, 0) + 1
    info: dict[str, GroupInfo] = {}
    for o in observations:
        if not o.document_id:
            continue
        key = _group_key(o)
        reasons = _reasons(o, per_test.get((o.document_id, key, o.test_code), 0) > 1)
        eligible = o.verification_status is ObservationVerification.PROPOSED and not reasons
        info[o.id] = GroupInfo(key, _CATEGORY_NAMES.get(_category(o), "Other results"), eligible, tuple(reasons))
    return info


def version_of(o: Observation) -> int:
    """Rises with every change, since every change appends a revision."""
    return max((r.id for r in o.revisions), default=0)


_CHANGED = "This group changed after it was shown, so nothing was approved. Check it again."


def approve_group(sessions: sessionmaker[Session], document_id: str, group_key: str, collected_on: str | None, items: list[GroupItem]) -> str:
    """Approves exactly the set shown, or nothing. Returns the approval's id.

    The write lock is taken before anything is read, so nothing can change between the checks and the approval.
    """
    with sessions() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        found = list(session.scalars(select(Observation).options(selectinload(Observation.revisions)).where(Observation.document_id == document_id)))
        info = review_groups(found)
        current = {o.id: o for o in found if info[o.id].eligible and info[o.id].key == group_key}
        wanted = {item.id: item.version for item in items}
        if len(wanted) != len(items) or not items or set(wanted) != set(current) or any(version_of(current[i]) != v for i, v in wanted.items()) or any(o.collected_on != collected_on for o in current.values()):
            raise UploadRejected(409, "group_changed", _CHANGED)
        now = _now()
        group = ReviewGroupApproval(document_id=document_id, group_key=group_key, collected_on=collected_on, result_count=len(current), approved_at=now)
        session.add(group)
        session.flush()
        for o in current.values():
            o.verification_status = ObservationVerification.VERIFIED
            o.approved_group_id = group.id
            _revise(session, o, RevisionAction.VERIFIED, group.id, now)
        session.commit()
        group_id = group.id
    log.info("group approval %s: %d measurements", group_id, len(items))
    return group_id


def undo_group(sessions: sessionmaker[Session], group_id: str) -> int:
    """Returns to review whatever that approval still accounts for. Results changed by hand since then stay as they are."""
    with sessions() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        group = session.get(ReviewGroupApproval, group_id)
        if group is None:
            raise UploadRejected(404, "not_found", "No such group approval.")
        if group.undone_at is not None:
            raise UploadRejected(409, "group_undone", "This group approval was already undone.")
        now = _now()
        found = list(session.scalars(select(Observation).where(Observation.approved_group_id == group_id)))
        for o in found:
            o.verification_status = ObservationVerification.PROPOSED
            o.approved_group_id = None
            _revise(session, o, RevisionAction.REOPENED, group_id, now)
        group.undone_at = now
        session.commit()
    log.info("group approval %s: undone, %d measurements back in review", group_id, len(found))
    return len(found)
