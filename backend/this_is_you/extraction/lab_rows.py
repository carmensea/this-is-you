"""Finds laboratory result rows in report text. Proposals only: a person accepts each one.

A row is recognized by its shape, one token at a time. What is not printed is left empty: no unit
is assumed, no date is borrowed, and no flag is worked out from the range.

Two shapes are understood:
- One result on one line, however its columns are ordered.
- Result tables with headings such as "Your Value" and "Standard Range". PDF text often comes out of these one cell per
  line, or with a label beside each value. After such a heading, cells are gathered into rows, across pages if need be.
  Only cells that follow one another under one test name are ever joined, so nothing is matched up by counting.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field, replace
from datetime import date

from ..lab_catalog import UNIT_WORDS, canonical_unit, find_test, longest_known_prefix, needs_unit
from .rules import Line, find_dates, to_lines

MAX_ROWS = 300
HIGH, MEDIUM, LOW = "high", "medium", "low"

_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)"
_VALUE = re.compile(rf"^(<=?|>=?|≤|≥)?({_NUMBER})(\*|H|L|HH|LL|A)?$")
_EUROPEAN_VALUE = re.compile(r"^\d+,\d{1,2}$")
_RANGE_TOKEN = re.compile(rf"^{_NUMBER}[-–—]{_NUMBER}$")
_BOUND_TOKEN = re.compile(rf"^(<=?|>=?|≤|≥){_NUMBER}$")
_FLAG = re.compile(r"^[\[(*]*(H|L|HH|LL|A|AB|HI|LO|HIGH|LOW|ABN|ABNORMAL|CRITICAL|CRIT|↑|↓)[\])*]*$", re.I)
_RANGE_SPACES = re.compile(rf"({_NUMBER})\s*(?:-|–|—|\bto\b)\s*({_NUMBER})", re.I)
_BOUND_SPACES = re.compile(rf"(<=?|>=?|≤|≥)\s+({_NUMBER})")
_DATE_LIKE = re.compile(r"\d{1,4}[/-]\d{1,2}[/-]\d{1,4}")
_NOISE_START = re.compile(r"^(page|phone|fax|tel|dob|mrn|id|account|acct|suite|zip|npi|clia|age|sex|specimen|accession|order|requisition|patient|physician|date|time|collected|reported|received)\b", re.I)
# Words that start lines around a results table. In a table, a test name is otherwise allowed to be unfamiliar.
_TABLE_NOISE_START = re.compile(r"^(results?|components?|standard|normal|reference|ref|value|your|flag|units?|comments?|notes?|interpretation|narrative|ordered|ordering|authorizing|authorized|provider|performing|performed|lab|laboratory|site|location|released|printed|view|sent|resulted|see|this|the|please|if|for|from|by|and|or|no|not|test|tests)\b", re.I)
# A per-volume unit this app has no spelling for is still printed as one, and is kept exactly as printed. Only inside a table.
_UNIT_SHAPE = re.compile(r"^(?:x?10[\^*eE(]?\d+\)?|[a-zA-Zµμ]{1,8})/(?:u|µ|μ|mc|m|d|n|p|f)?[Ll]$")
_WORD_RESULTS = {
    "negative", "positive", "normal", "abnormal", "none seen", "not detected", "detected", "nonreactive", "non-reactive", "reactive", "trace",
    # Graded amounts, as urine sediment is reported.
    "none", "not seen", "rare", "few", "occasional", "moderate", "many", "marked", "present", "absent", "too numerous to count", "tntc",
    "1+", "2+", "3+", "4+",
}
_WORD_RANGE_STARTS = re.compile(r"^(not estab|see below|see note|negative|none seen|not seen|none|absent|not detected|nonreactive|non-reactive|normal)", re.I)
# A whole row whose result is a word: "Bacteria None seen None seen". The name is the shortest start that leaves a known word.
_WORD_ROW = re.compile(r"^(.+?)\s+(" + "|".join(sorted(map(re.escape, _WORD_RESULTS), key=len, reverse=True)) + r")(?:\s+(.+))?$", re.I)
_SENTENCE_VERBS = {"is", "are", "was", "were", "be", "been", "seen", "noted"}

_COLLECTED = re.compile(r"\b(?:specimen collect(?:ed|ion)(?: date)?|collection date(?:/time)?|collection time|collected date|date collected|date of collection|date drawn|drawn(?: on)?|collected(?: on)?)\b", re.I)
_SERVICE = re.compile(r"\b(?:date of service|service date)\b", re.I)
_REPORTED = re.compile(r"\b(?:report date|date reported|reported(?: on)?|final report date|resulted(?: on)?|date resulted|result date)\b", re.I)

# Labels that say what the next cell is. Long enough to be unmistakable anywhere on a line.
_STRONG_LABELS = {"your value": "value", "standard range": "range", "reference range": "range", "normal range": "range", "ref range": "range", "reference interval": "range"}
_STRONG = re.compile(r"\b(" + "|".join(_STRONG_LABELS) + r")\b\s*:?\s*", re.I)
# Short words that are only labels when they are all a line says, or start it with a colon.
_WEAK_LABELS = {"value": "value", "result": "value", "results": None, "flag": "flag", "units": "unit", "unit": "unit", "component": None, "components": None, "component results": None, "test": None, "test name": None, "name": None}
_WEAK_COLON = re.compile(r"^(?:(value|result)\s*:?\s+(?=[<>≤≥\d])|(flag|units?)\s*:\s*)(.+)$", re.I)
_HEADER_WORDS = re.compile(r"\b(?:your value|standard range|reference range|normal range|ref range|reference interval|component results|components?|results?|value|flag|units?|test name|test|name)\b", re.I)
_TABLE_START = re.compile(r"\b(your value|standard range|component results?)\b", re.I)


def has_results_table(pages: list[tuple[int, str]]) -> bool:
    return any(_TABLE_START.search(text) for _, text in pages)


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
    section: int = 0  # Rises each time the report prints a different collection line.

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
    # Numeric dates are month first. That is a rule of this archive, so it is not a doubt.
    if first.two_digit_year:
        return _Dated(first.iso, "This date is written with a two-digit year.")
    return _Dated(first.iso, None)


@dataclass
class _Cells:
    """What the words of a line, or of several cells, have said so far."""

    value: str | None = None
    unit: str | None = None
    reference: str | None = None
    flag: str | None = None
    extra_numbers: list[str] = field(default_factory=list)
    european: bool = False
    other_unit: str | None = None
    leftovers: int = 0
    range_from_label: bool = False  # The reference came from a "Standard Range" label, so it is never the result.


def _normalize_spacing(text: str) -> str:
    return _BOUND_SPACES.sub(r"\1\2", _RANGE_SPACES.sub(r"\1-\2", text))


def _read_words(words: list[str], cells: _Cells, table: bool) -> None:
    # The one unit in a blood count that is printed as two words.
    joined = " ".join(words).replace("/100 WBC", "/100\0WBC").split()
    for word in [w.replace("\0", " ") for w in joined]:
        lower = word.lower()
        if lower in UNIT_WORDS or (table and _UNIT_SHAPE.match(word)):
            if cells.unit is None:
                cells.unit = word
            elif canonical_unit(word) != canonical_unit(cells.unit):
                cells.other_unit = word
        elif _RANGE_TOKEN.match(word) and cells.reference is None:
            cells.reference = word
        elif table and _RANGE_TOKEN.match(word) and cells.value is None and not cells.range_from_label and _RANGE_TOKEN.match(cells.reference or ""):
            # Two ranges and no value: the first, in the value column, is the result printed as a range ("0-2 /HPF").
            cells.value, cells.reference = cells.reference, word
        elif _FLAG.match(word) and cells.flag is None and (cells.value is not None or len(word) <= 8):
            cells.flag = word.strip("[]()*")
        elif table and _FLAG.match(word) and cells.flag is not None:
            cells.flag = f"{cells.flag} {word.strip('[]()*')}"  # "Critical High" is one flag.
        elif _BOUND_TOKEN.match(word) and cells.value is not None and cells.reference is None:
            cells.reference = word
        elif (match := _VALUE.match(word)) and cells.value is None:
            cells.value = (match[1] or "") + match[2]
            if match[3] and match[3] != "*":
                cells.flag = cells.flag or match[3]
        elif _VALUE.match(word):
            cells.extra_numbers.append(word)
        elif _EUROPEAN_VALUE.match(word) and cells.value is None:
            cells.value, cells.european = word, True
        else:
            cells.leftovers += 1


def _assess(name: str, cells: _Cells, extra: list[str] | None = None) -> tuple[list[str], str]:
    test = find_test(name, cells.unit)
    value = cells.value or ""
    issues: list[str] = list(extra or [])
    if not value:
        issues.insert(0, "No value could be read for this test. Enter it from the original.")
    if cells.unit is None and value:
        issues.append("No unit was printed on this line. None was assumed.")
    elif cells.unit is not None and test is not None and canonical_unit(cells.unit) not in test.expected_units:
        issues.append(f"The unit {cells.unit} is unusual for {test.short}. Check it against the original.")
    if test is None:
        if needs_unit(name) and cells.unit is None:
            issues.append(f"{name} could be a percentage or a count, and the printed unit is what says which.")
        else:
            issues.append("This test name is not in the known list. Check it is really a result.")
    if cells.other_unit:
        issues.append(f"Two different units were printed for this result: {cells.unit} and {cells.other_unit}.")
    if cells.extra_numbers:
        issues.append(f"Another number on this line ({cells.extra_numbers[0]}) could be the result, such as a previous value.")
    if cells.european:
        issues.append(f"The value {value} uses a comma, which could be a decimal point or a thousands separator.")
    if value[:1] in ("<", ">", "≤", "≥"):
        issues.append("This value is reported as a limit rather than an exact number, so it will not be graphed.")
    elif _RANGE_TOKEN.match(value):
        issues.append("This result is printed as a range rather than one number, so it will not be graphed.")
    elif value and value.lower() in _WORD_RESULTS:
        issues.append("This result is a word rather than a number, so it will not be graphed.")
    return issues, LOW if issues or test is None else (HIGH if cells.reference else MEDIUM)


def _parse_row(line: Line, today: date, table: bool = False) -> LabRow | None:
    text = _normalize_spacing(line.text)
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
    cells = _Cells()
    _read_words(words[index:], cells, table)
    if cells.value is None:
        return None
    test = find_test(name, cells.unit)
    # An unknown name is only a result if it looks unmistakably like one. In a results table the heading already says
    # these are results, so a shorter row is allowed through, as long as nothing on the line is left unexplained.
    if test is None and (cells.unit is None or cells.reference is None):
        if not table or cells.leftovers or _TABLE_NOISE_START.match(words[0]) or find_dates(line.text, today):
            return None
    issues, confidence = _assess(name, cells)
    return LabRow(name, cells.value, cells.unit, cells.reference, cells.flag, None, None, line.page, line.index + 1, line.text[:200], confidence, issues)


@dataclass
class _Pending:
    """A row being gathered from separate cells."""

    name: str
    first: Line
    cells: _Cells = field(default_factory=_Cells)
    parts: list[str] = field(default_factory=list)
    last_page: int = 0
    expect: str | None = None
    unread: str | None = None  # A cell under the name that could not be read. The name is kept, with no value.

    def has_anything(self) -> bool:
        c = self.cells
        return c.value is not None or c.unit is not None or c.reference is not None or c.flag is not None


def _split_labels(text: str) -> list[tuple[str | None, str]]:
    """A line as (what its label says it is, the text after that label). The first part may have no label."""
    parts: list[tuple[str | None, str]] = []
    position, slot = 0, None
    for match in _STRONG.finditer(text):
        before = text[position:match.start()].strip()
        if before or parts:
            parts.append((slot, before))
        position, slot = match.end(), _STRONG_LABELS[match[1].lower()]
    parts.append((slot, text[position:].strip()))
    # A flag label in the middle of a labelled line: "Standard Range 3-10 Flag High".
    split: list[tuple[str | None, str]] = []
    for kind, part in parts:
        if kind is not None and (found := re.match(r"^(.*?)\s*\bflag\b\s*:?\s*(.*)$", part, re.I)):
            split += [(kind, found[1]), ("flag", found[2])]
        else:
            split.append((kind, part))
    return split


def _word_row(line: Line, today: date) -> LabRow | None:
    match = _WORD_ROW.match(line.text)
    if not match:
        return None
    name, rest = match[1].strip(" .:;*"), match[3]
    if not _looks_like_name(name, today) or _SENTENCE_VERBS & set(name.lower().split()):
        return None
    if rest and not (_WORD_RANGE_STARTS.match(rest) or rest.lower() in _WORD_RESULTS):
        return None
    cells = _Cells(value=match[2], reference=rest[:60] if rest else None)
    issues, confidence = _assess(name, cells)
    return LabRow(name, cells.value, None, cells.reference, None, None, None, line.page, line.index + 1, line.text[:200], confidence, issues)


def _unread_cell(text: str) -> bool:
    """Short and shaped like a value, but not readable as one, such as "0-2/HPF0-5/HPF". Words are never taken for one."""
    return (text[0].isdigit() or text[0] in "<>≤≥+-") and len(text.split()) <= 4 and not _DATE_LIKE.search(text)


def _is_header(text: str) -> bool:
    return not _HEADER_WORDS.sub(" ", text).strip(" |:-")


def _looks_like_name(text: str, today: date) -> bool:
    words = text.split()
    return (
        len(words) <= 7 and len(text) <= 80 and words[0][0].isalpha() and text.lower() not in _WORD_RESULTS and ":" not in text and not text.endswith((".", "?", "!"))
        and not _NOISE_START.match(words[0]) and not _TABLE_NOISE_START.match(words[0]) and not find_dates(text, today) and not _DATE_LIKE.search(text)
    )


def _into(pending: _Pending, slot: str | None, text: str) -> bool:
    """Puts a cell's text into the row. False if it does not read as a cell of a row at all."""
    if not text:
        pending.expect = slot
        return True
    normalized = _normalize_spacing(text)
    cells = pending.cells
    if slot == "range" and cells.reference is None:
        cells.range_from_label = True
        words = normalized.split()
        # What follows the numbers can only be a unit. Words stay as printed: "Not Estab." is a real answer.
        if not (_RANGE_TOKEN.match(words[0]) or _BOUND_TOKEN.match(words[0]) or _VALUE.match(words[0])):
            cells.reference = text[:60]
        else:
            cells.reference = words[0]
            unit_cells = _Cells(unit=cells.unit)
            _read_words(words[1:], unit_cells, True)
            cells.unit, cells.other_unit = unit_cells.unit, unit_cells.other_unit or cells.other_unit
            cells.flag = cells.flag or unit_cells.flag
    elif slot == "value" and cells.value is None and _RANGE_TOKEN.match(normalized.split()[0]):
        words = normalized.split()
        unit_cells = _Cells(unit=cells.unit)
        _read_words(words[1:], unit_cells, True)
        if unit_cells.leftovers:
            return False
        cells.value, cells.unit = words[0], unit_cells.unit
    elif text.lower() in _WORD_RESULTS and (slot == "value" or cells.value is None):
        cells.value = text
    elif cells.value is not None and cells.reference is None and _WORD_RANGE_STARTS.match(text):
        cells.reference = text[:60]
    elif text.lower() == "normal" and cells.value is not None:
        pass  # A flag column saying nothing is wrong. Not a flag.
    else:
        trial = replace(cells, extra_numbers=list(cells.extra_numbers), leftovers=0)
        _read_words(normalized.split(), trial, True)
        if trial.leftovers:
            return False
        pending.cells = trial
    pending.expect = None
    return True


def _rows_from_lines(lines: list[Line], today: date) -> list[LabRow]:
    rows: list[LabRow] = []
    collected: _Dated | None = None
    service: _Dated | None = None
    reported: _Dated | None = None
    all_collected: set[str] = set()
    needs_backfill: list[tuple[LabRow, str]] = []  # With its confidence before any penalty for the date.
    in_table = False
    pending: _Pending | None = None
    section = 0
    collection_line: str | None = None

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

    def add(row: LabRow) -> None:
        row.section = section
        assessed = row.confidence
        add_date_issues(row)
        if collected is None:
            needs_backfill.append((row, assessed))
        rows.append(row)

    def finish_pending() -> None:
        nonlocal pending
        row, pending = pending, None
        # A heading such as "CBC with Differential" has a name and nothing else. A row needs at least something measured.
        if row is None or not (row.has_anything() or row.unread) or len(rows) >= MAX_ROWS:
            return
        extra = ["This result continues across a page break. Check the name and value belong together."] if row.last_page != row.first.page else []
        issues, confidence = _assess(row.name, row.cells, extra)
        if row.unread:
            issues = [f'The printed value could not be read: "{row.unread[:60]}". Enter it from the original.'] + [i for i in issues if not i.startswith("No value could be read")]
        c = row.cells
        add(LabRow(row.name, c.value or "", c.unit, c.reference, c.flag, None, None, row.first.page, row.first.index + 1, " | ".join(row.parts)[:200], confidence, issues))

    for line in lines:
        if found := _labeled_date(_COLLECTED, line.text, today):
            finish_pending()
            # A repeated page heading says the same thing again. A different line, even on one day, is another collection.
            if collection_line is not None and line.text != collection_line:
                section += 1
            collection_line = line.text
            collected = found
            all_collected.add(found.iso)
            continue_scan = _labeled_date(_REPORTED, line.text, today)
            reported = continue_scan or reported
            continue
        if found := _labeled_date(_REPORTED, line.text, today):
            finish_pending()
            reported = found
            continue
        if found := _labeled_date(_SERVICE, line.text, today):
            finish_pending()
            service = found
            continue
        if len(rows) >= MAX_ROWS:
            break
        if not in_table and not _TABLE_START.search(line.text):
            row = _parse_row(line, today)
            if row is not None:
                add(row)
            continue
        in_table = True

        if _is_header(line.text):
            # Alone under a test name, a label says what the next cell is. Several together are the table's heading row.
            slots = line.text.lower().strip(" :")
            if pending is not None and (slots in _STRONG_LABELS or slots in _WEAK_LABELS):
                pending.expect = _STRONG_LABELS.get(slots) or _WEAK_LABELS.get(slots)
            else:
                finish_pending()
            continue
        if _NOISE_START.match(line.text):
            continue  # A page header or footer. A table carries on past it.
        if weak := _WEAK_COLON.match(line.text):
            if pending is not None:
                _into(pending, _WEAK_LABELS[(weak[1] or weak[2]).lower()], weak[3])
                pending.parts.append(line.text)
                pending.last_page = line.page
            continue

        parts = _split_labels(line.text)
        if len(parts) > 1 or parts[0][0] is not None:
            # "WBC Your Value 6.2 x10E3/uL Standard Range 3.4 - 10.8", or one labelled cell on its own line.
            if parts[0][0] is None:
                finish_pending()
                if not _looks_like_name(parts[0][1], today):
                    continue
                pending = _Pending(parts[0][1].strip(" .:;*"), line, last_page=line.page)
                parts = parts[1:]
            if pending is not None:
                for slot, text in parts:
                    _into(pending, slot, text)
                pending.parts.append(line.text)
                pending.last_page = line.page
            continue

        # A whole row on one line.
        row = _parse_row(line, today, table=True) or _word_row(line, today)
        if row is not None:
            finish_pending()
            add(row)
            continue

        if pending is not None:
            expected = pending.expect
            if _into(pending, expected, line.text) if (expected or pending.has_anything()) else _into(pending, None, line.text):
                pending.parts.append(line.text)
                pending.last_page = line.page
                continue
            if not pending.has_anything() and _unread_cell(line.text):
                pending.unread = line.text
                pending.parts.append(line.text)
                finish_pending()
                continue
        elif _DATE_LIKE.search(line.text) or line.text[0].isdigit() or line.text[0] in "<>≤≥":
            continue  # A cell with no test name above it. There is no telling what it belongs to.

        if _looks_like_name(line.text, today):
            name = line.text.strip(" .:;*")
            # A long name wrapped onto a second line.
            if pending is not None and not pending.has_anything():
                joined = f"{pending.name} {name}"
                if find_test(joined) is not None or needs_unit(joined):
                    pending.name = joined
                    pending.parts.append(line.text)
                    continue
            finish_pending()
            pending = _Pending(name, line, parts=[line.text], last_page=line.page)
        else:
            finish_pending()  # Prose. Whatever came before it is finished.
    finish_pending()

    # Reports often print results before the header details. If one collection date covers the whole
    # report, it applies to those rows too. With several, there is no telling, so they stay unknown.
    if len(all_collected) == 1 and collected is not None:
        for row, assessed in needs_backfill:
            row.collected = collected.iso
            row.section = section
            row.issues = [i for i in row.issues if "No collection date" not in i and "date of service" not in i]
            if collected.issue:
                row.issues.append(collected.issue)
            # Confidence follows the warnings that remain, so a resolved date takes its penalty with it.
            row.confidence = LOW if row.issues else assessed
    if reported is not None:
        for row in rows:
            row.reported = reported.iso
    return rows


def parse_lab_rows(pages: list[tuple[int, str]], today: date) -> list[LabRow]:
    return _rows_from_lines(to_lines(pages), today)
