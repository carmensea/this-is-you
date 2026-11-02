"""Finds laboratory result rows in report text. Proposals only: a person accepts each one.

A row is recognized by its shape, one token at a time. What is not printed is left empty: no unit
is assumed, no date is borrowed, and no flag is worked out from the range.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date

from ..lab_catalog import UNIT_WORDS, canonical_unit, find_test, longest_known_prefix
from .rules import Line, find_dates, to_lines

MAX_ROWS = 300
HIGH, MEDIUM, LOW = "high", "medium", "low"

_NUMBER = r"\d+(?:\.\d+)?"
_VALUE = re.compile(rf"^(<=?|>=?|≤|≥)?({_NUMBER}|\d{{1,3}}(?:,\d{{3}})+)(\*|H|L|HH|LL|A)?$")
_EUROPEAN_VALUE = re.compile(r"^\d+,\d{1,2}$")
_RANGE_TOKEN = re.compile(rf"^{_NUMBER}[-–—]{_NUMBER}$")
_BOUND_TOKEN = re.compile(rf"^(<=?|>=?|≤|≥){_NUMBER}$")
_FLAG = re.compile(r"^[\[(*]*(H|L|HH|LL|A|AB|HI|LO|HIGH|LOW|ABN|ABNORMAL|CRITICAL|CRIT)[\])*]*$", re.I)
_RANGE_SPACES = re.compile(rf"({_NUMBER})\s*(?:-|–|—|\bto\b)\s*({_NUMBER})", re.I)
_BOUND_SPACES = re.compile(rf"(<=?|>=?|≤|≥)\s+({_NUMBER})")
_DATE_LIKE = re.compile(r"\d{1,4}[/-]\d{1,2}[/-]\d{1,4}")
_NOISE_START = re.compile(r"^(page|phone|fax|tel|dob|mrn|id|account|acct|suite|zip|npi|clia|age|sex|specimen|accession|order|requisition|patient|physician|date|time|collected|reported|received)\b", re.I)

_COLLECTED = re.compile(r"\b(?:specimen collect(?:ed|ion)(?: date)?|collection date(?:/time)?|collected date|date collected|date of collection|date drawn|drawn(?: on)?|collected(?: on)?)\b", re.I)
_SERVICE = re.compile(r"\b(?:date of service|service date)\b", re.I)
_REPORTED = re.compile(r"\b(?:report date|date reported|reported(?: on)?|final report date|resulted(?: on)?|date resulted)\b", re.I)


@dataclass
class LabRow:
    name: str
    value: str
    unit: str | None
    reference: str | None
    flag: str | None
    collected: str | None
    reported: str | None
    page: int
    line: int
    source: str
    confidence: str
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class _Dated:
    iso: str
    issue: str | None


def _labeled_date(pattern: re.Pattern, text: str, today: date) -> _Dated | None:
    match = pattern.search(text)
    if not match:
        return None
    found = find_dates(text[match.end():][:40], today)
    if not found:
        return None
    first = found[0]
    if first.ambiguous:
        return _Dated(first.iso, f"This date could be read two ways: {first.iso} or {first.ambiguous}.")
    if first.two_digit_year:
        return _Dated(first.iso, "This date is written with a two-digit year.")
    return _Dated(first.iso, None)


def _parse_row(line: Line) -> LabRow | None:
    text = _BOUND_SPACES.sub(r"\1\2", _RANGE_SPACES.sub(r"\1-\2", line.text))
    if _DATE_LIKE.search(text):
        return None
    words = text.split()
    known = longest_known_prefix(words)
    index = known
    if not known:
        # An unknown test needs a name made of words, followed by a value.
        while index < len(words) and not (_VALUE.match(words[index]) or _RANGE_TOKEN.match(words[index]) or _EUROPEAN_VALUE.match(words[index])):
            index += 1
        if index == 0 or index == len(words) or index > 7 or not words[0][0].isalpha() or _NOISE_START.match(words[0]) or any(":" in w for w in words[:index]):
            return None
    name = " ".join(words[:index]).strip(" .:;*")
    value = flag = unit = reference = None
    extra_numbers: list[str] = []
    european = False
    for word in words[index:]:
        lower = word.lower()
        if lower in UNIT_WORDS and unit is None:
            unit = word
        elif _RANGE_TOKEN.match(word) and reference is None:
            reference = word
        elif _FLAG.match(word) and flag is None and (value is not None or len(word) <= 8):
            flag = word.strip("[]()*")
        elif _BOUND_TOKEN.match(word) and value is not None and reference is None:
            reference = word
        elif (match := _VALUE.match(word)) and value is None:
            value = (match[1] or "") + match[2]
            if match[3] and match[3] != "*":
                flag = flag or match[3]
        elif _VALUE.match(word):
            extra_numbers.append(word)
        elif _EUROPEAN_VALUE.match(word) and value is None:
            value, european = word, True
    if value is None:
        return None
    test = find_test(name)
    # An unknown name is only a result if it looks unmistakably like one.
    if test is None and (unit is None or reference is None):
        return None
    issues: list[str] = []
    if unit is None:
        issues.append("No unit was printed on this line. None was assumed.")
    elif test is not None and canonical_unit(unit) not in test.expected_units:
        issues.append(f"The unit {unit} is unusual for {test.short}. Check it against the original.")
    if test is None:
        issues.append("This test name is not in the known list. Check it is really a result.")
    if extra_numbers:
        issues.append(f"Another number on this line ({extra_numbers[0]}) could be the result, such as a previous value.")
    if european:
        issues.append(f"The value {value} uses a comma, which could be a decimal point or a thousands separator.")
    if value[0] in "<>≤≥":
        issues.append("This value is reported as a limit rather than an exact number, so it will not be graphed.")
    confidence = LOW if issues or test is None else (HIGH if reference else MEDIUM)
    return LabRow(name, value, unit, reference, flag, None, None, line.page, line.index + 1, line.text[:200], confidence, issues)


def _rows_from_lines(lines: list[Line], today: date) -> list[LabRow]:
    rows: list[LabRow] = []
    collected: _Dated | None = None
    service: _Dated | None = None
    reported: _Dated | None = None
    all_collected: set[str] = set()
    needs_backfill: list[LabRow] = []

    def add_date_issues(row: LabRow) -> None:
        source = collected or service
        if source is None:
            row.issues.append("No collection date was found. It stays unknown until you enter it.")
            row.confidence = LOW
            return
        row.collected = source.iso
        if source.issue:
            row.issues.append(source.issue)
            row.confidence = LOW
        if collected is None:
            row.issues.append('Dated from a "date of service" label, not a collection date. Check it.')
            row.confidence = LOW

    for line in lines:
        if found := _labeled_date(_COLLECTED, line.text, today):
            collected = found
            all_collected.add(found.iso)
            continue_scan = _labeled_date(_REPORTED, line.text, today)
            reported = continue_scan or reported
            continue
        if found := _labeled_date(_REPORTED, line.text, today):
            reported = found
            continue
        if found := _labeled_date(_SERVICE, line.text, today):
            service = found
            continue
        if len(rows) >= MAX_ROWS:
            break
        row = _parse_row(line)
        if row is None:
            continue
        add_date_issues(row)
        if collected is None:
            needs_backfill.append(row)
        rows.append(row)

    # Reports often print results before the header details. If one collection date covers the whole
    # report, it applies to those rows too. With several, there is no telling, so they stay unknown.
    if len(all_collected) == 1 and collected is not None:
        for row in needs_backfill:
            row.collected = collected.iso
            row.issues = [i for i in row.issues if "No collection date" not in i and "date of service" not in i]
            if collected.issue:
                row.issues.append(collected.issue)
    if reported is not None:
        for row in rows:
            row.reported = reported.iso
    return rows


def parse_lab_rows(pages: list[tuple[int, str]], today: date) -> list[LabRow]:
    return _rows_from_lines(to_lines(pages), today)
