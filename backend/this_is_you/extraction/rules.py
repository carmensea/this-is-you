"""Proposes document metadata from text using fixed rules. Every result is a proposal for a person to check.

Input is untrusted, so patterns are simple, lines are capped, and nothing here runs in the main service.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date

MAX_LINE = 300
MAX_SNIPPET = 200
HEAD_LINES = 15

HIGH, MEDIUM, LOW = "high", "medium", "low"


@dataclass(frozen=True)
class Proposal:
    field: str
    value: str
    confidence: str
    reason: str
    page: int
    snippet: str

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Line:
    page: int
    index: int  # Position on its page
    text: str


def to_lines(pages: list[tuple[int, str]]) -> list[Line]:
    lines = []
    for page, text in pages:
        index = 0
        for raw in text.splitlines():
            cleaned = " ".join(raw.split())[:MAX_LINE]
            if cleaned:
                lines.append(Line(page, index, cleaned))
                index += 1
    return lines


# ---- Document type

_TYPE_TERMS: dict[str, list[tuple[str, int]]] = {
    "lab": [("laboratory report", 5), ("lab report", 5), ("laboratory results", 5), ("lab results", 5), ("reference range", 2), ("specimen collected", 2), ("complete blood count", 2), ("metabolic panel", 2), ("lipid panel", 2), ("hemoglobin a1c", 2), ("specimen", 1)],
    "imaging": [("radiology report", 5), ("imaging report", 5), ("diagnostic imaging", 3), ("radiologist", 2), ("mri", 2), ("x-ray", 2), ("ultrasound", 2), ("ct scan", 2), ("mammogram", 2), ("impression", 1), ("technique", 1)],
    "pathology": [("pathology report", 5), ("surgical pathology", 5), ("gross description", 3), ("microscopic description", 3), ("pathologist", 2), ("biopsy", 1)],
    "procedure": [("operative report", 5), ("operative note", 5), ("procedure note", 5), ("procedure report", 5), ("preoperative diagnosis", 3), ("postoperative diagnosis", 3), ("procedure performed", 2), ("anesthesia", 1)],
    "note": [("progress note", 5), ("office visit", 5), ("visit note", 5), ("clinical note", 5), ("discharge summary", 5), ("consultation note", 5), ("history of present illness", 3), ("chief complaint", 3), ("assessment and plan", 2)],
}
_TYPE_PATTERNS = {kind: [(term, weight, re.compile(rf"\b{re.escape(term)}\b", re.I)) for term, weight in terms] for kind, terms in _TYPE_TERMS.items()}


def propose_type(lines: list[Line]) -> Proposal | None:
    scores: dict[str, int] = {}
    evidence: dict[str, tuple[int, Line, str]] = {}
    found: dict[str, set[str]] = {}
    for line in lines:
        early = line.page == 1 and line.index < HEAD_LINES
        for kind, patterns in _TYPE_PATTERNS.items():
            for term, weight, pattern in patterns:
                if term in found.setdefault(kind, set()) or not pattern.search(line.text):
                    continue
                found[kind].add(term)
                points = weight * 2 if early else weight
                scores[kind] = scores.get(kind, 0) + points
                if kind not in evidence or points > evidence[kind][0]:
                    evidence[kind] = (points, line, term)
    if not scores:
        return None
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    kind, top = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    if top >= 10 and top >= runner_up * 2:
        confidence = HIGH
    elif top >= 4 and top > runner_up:
        confidence = MEDIUM
    else:
        confidence = LOW
    _, line, term = evidence[kind]
    others = len(found[kind]) - 1
    reason = f'Found "{term}"' + (f" and {others} other related term{'s' if others != 1 else ''}" if others else "") + "."
    if runner_up and top < runner_up * 2:
        reason += f" Terms from another document type also appear ({ranked[1][0]})."
    return Proposal("document_type", kind, confidence, reason, line.page, line.text[:MAX_SNIPPET])


# ---- Service date

_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?"
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_NUMERIC = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b")
_MONTH_FIRST = re.compile(rf"\b{_MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I)
_DAY_FIRST = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?[\s-]+{_MONTH}[\s,-]+(\d{{4}})\b", re.I)

# Most specific first. Earlier groups win over later ones.
_DATE_LABELS = [
    re.compile(r"\b(date of service|service date|dos|date of visit|visit date|encounter date|date of exam(?:ination)?|exam date|study date|date of study|date of procedure|procedure date|date of surgery|surgery date)\b", re.I),
    re.compile(r"\b(collection date|date collected|collected(?: on)?|specimen collected|date of collection)\b", re.I),
]
_NOT_SERVICE = re.compile(r"\b(birth|dob|born|printed|faxed?|expires?|reported|received|signed)\b", re.I)


@dataclass(frozen=True)
class FoundDate:
    iso: str
    ambiguous: str | None  # The day-first reading. Dates are read month first, and only the identity check looks at this.
    two_digit_year: bool
    start: int


def _valid(year: int, month: int, day: int, today: date) -> str | None:
    try:
        parsed = date(year, month, day)
    except ValueError:
        return None
    return parsed.isoformat() if date(1900, 1, 1) <= parsed <= today else None


def find_dates(text: str, today: date) -> list[FoundDate]:
    found: list[FoundDate] = []
    for m in _ISO.finditer(text):
        if iso := _valid(int(m[1]), int(m[2]), int(m[3]), today):
            found.append(FoundDate(iso, None, False, m.start()))
    for m in _NUMERIC.finditer(text):
        first, second, raw_year = int(m[1]), int(m[2]), int(m[3])
        two_digit = len(m[3]) == 2
        year = raw_year if not two_digit else (2000 + raw_year if 2000 + raw_year <= today.year else 1900 + raw_year)
        month_first = _valid(year, first, second, today)
        day_first = _valid(year, second, first, today)
        if month_first:
            other = day_first if day_first and day_first != month_first else None
            found.append(FoundDate(month_first, other, two_digit, m.start()))
        elif day_first:
            found.append(FoundDate(day_first, None, two_digit, m.start()))
    for m in _MONTH_FIRST.finditer(text):
        if iso := _valid(int(m[3]), _MONTHS[m[1].lower()], int(m[2]), today):
            found.append(FoundDate(iso, None, False, m.start()))
    for m in _DAY_FIRST.finditer(text):
        if iso := _valid(int(m[3]), _MONTHS[m[2].lower()], int(m[1]), today):
            found.append(FoundDate(iso, None, False, m.start()))
    return sorted(found, key=lambda f: f.start)


def _date_proposal(found: FoundDate, line: Line, confidence: str, reason: str) -> Proposal:
    # Numeric dates are month first. That is a rule of this archive, so it is not a doubt.
    if found.two_digit_year:
        confidence, reason = LOW, reason + " The year is written with two digits."
    return Proposal("service_date", found.iso, confidence, reason, line.page, line.text[:MAX_SNIPPET])


def propose_service_date(lines: list[Line], today: date) -> Proposal | None:
    for labels in _DATE_LABELS:
        hits: list[tuple[FoundDate, Line, str]] = []
        for line in lines:
            match = labels.search(line.text)
            if not match:
                continue
            after = line.text[match.end():][:60]
            dates = find_dates(after, today)
            if dates:
                hits.append((dates[0], line, match.group(1).lower()))
        if hits:
            found, line, label = hits[0]
            distinct = {h[0].iso for h in hits}
            if len(distinct) > 1:
                return _date_proposal(found, line, LOW, f'Found {len(distinct)} different dates labeled "{label}". Showing the first.')
            return _date_proposal(found, line, HIGH, f'Labeled "{label}" in the document.')
    # No label. A date alone on the first page is only a guess, and only if it is the sole candidate.
    candidates = [(f, line) for line in lines if line.page == 1 and not _NOT_SERVICE.search(line.text) for f in find_dates(line.text, today)]
    if len({f.iso for f, _ in candidates}) == 1:
        found, line = candidates[0]
        return _date_proposal(found, line, LOW, "The only date on the first page, with no label saying what it means.")
    return None


# ---- Provider

_ORG_LABELS = re.compile(r"^\s*(performing (?:laboratory|lab)|laboratory|facility|clinic|hospital|practice|organization|imaging (?:center|facility))\s*(?:name)?\s*[:#-]\s*(.+)$", re.I)
_PERSON_LABELS = re.compile(r"^\s*(ordering (?:physician|provider|clinician)|referring (?:physician|provider)|attending(?: physician)?|provider|physician|clinician|radiologist|pathologist|surgeon|performed by|interpreted by)\s*(?:name)?\s*[:#-]\s*(.+)$", re.I)
_ORG_WORD = re.compile(r"\b(laboratory|laboratories|diagnostics|medical center|medical group|hospital|clinic|imaging|radiology|pathology|family medicine|family practice|health system|dermatology|physical therapy)\b", re.I)
_DOCUMENT_WORD = re.compile(r"\b(report|results?|note|summary|patient|page|date|dob)\b", re.I)


def _plausible_name(value: str) -> str | None:
    value = re.split(r"\s{2,}|\s[|]\s", value, maxsplit=1)[0].strip(" .,:;-")
    if not 2 <= len(value) <= 120 or not value[0].isalpha():
        return None
    letters = sum(c.isalpha() for c in value)
    return value if letters >= len(value) * 0.6 else None


def propose_provider(lines: list[Line]) -> Proposal | None:
    for line in lines:
        match = _ORG_LABELS.match(line.text)
        if match and (name := _plausible_name(match[2])):
            return Proposal("provider", name, HIGH, f'Labeled "{match[1].lower()}" in the document.', line.page, line.text[:MAX_SNIPPET])
    for line in lines:
        if line.page == 1 and line.index < 6 and _ORG_WORD.search(line.text) and not _DOCUMENT_WORD.search(line.text) and ":" not in line.text:
            if name := _plausible_name(line.text):
                return Proposal("provider", name, MEDIUM, "Looks like the letterhead at the top of the first page.", line.page, line.text[:MAX_SNIPPET])
    for line in lines:
        match = _PERSON_LABELS.match(line.text)
        if match and (name := _plausible_name(match[2])):
            return Proposal("provider", name, MEDIUM, f'Labeled "{match[1].lower()}". This is a person, not necessarily the organization.', line.page, line.text[:MAX_SNIPPET])
    return None


# ---- Report title

_TITLE_WORD = re.compile(r"\b(report|results|note|summary|consultation|study|panel|examination)\b", re.I)
_EXPLICIT_TITLE = re.compile(r"\b(laboratory|lab|radiology|imaging|pathology|operative|procedure|progress|visit|discharge)\s+(report|results|note|summary)\b", re.I)
_LOOKS_LIKE_FIELD = re.compile(r":|\b(page \d|patient)\b", re.I)


# The heading of a results table says nothing about what the document is.
_TABLE_HEADING = re.compile(r"^(component|test)?\s*(results?|report)$", re.I)


def propose_title(lines: list[Line], embedded_title: str | None, today: date) -> Proposal | None:
    for line in lines:
        if line.page != 1 or line.index >= HEAD_LINES:
            break
        text = line.text
        if len(text) > 90 or _LOOKS_LIKE_FIELD.search(text) or find_dates(text, today) or not _TITLE_WORD.search(text) or _TABLE_HEADING.match(text):
            continue
        if _EXPLICIT_TITLE.search(text):
            return Proposal("report_title", text, HIGH, "A heading near the top of the first page.", 1, text[:MAX_SNIPPET])
        return Proposal("report_title", text, MEDIUM, "Looks like a heading near the top of the first page.", 1, text[:MAX_SNIPPET])
    cleaned = " ".join((embedded_title or "").split())[:120]
    if len(cleaned) >= 3 and sum(c.isalpha() for c in cleaned) >= len(cleaned) * 0.5 and not cleaned.lower().endswith((".pdf", ".doc", ".docx")):
        return Proposal("report_title", cleaned, LOW, "From the title stored in the file's properties, which is often wrong.", 1, "")
    return None


def propose_all(pages: list[tuple[int, str]], embedded_title: str | None, today: date) -> list[Proposal]:
    lines = to_lines(pages)
    results = [propose_type(lines), propose_service_date(lines, today), propose_provider(lines), propose_title(lines, embedded_title, today)]
    return [r for r in results if r is not None]


# ---- Whose document is this? Reports what is printed. Comparing it with anyone is done elsewhere.

_NAME_LABEL = re.compile(r"^(?:re:\s*)?(?:patient(?:'s)?(?:\s+full)?\s+name|patient|pt\.?\s+name|name\s+of\s+patient|name)\s*[:#]\s*(.+)$", re.I)
_NAME_STOP = re.compile(r"\s+(?:dob|d\.o\.b|date\s+of\s+birth|birth\s*date|mrn|age|sex|gender|id|account|acct|phone|ssn)\b.*$", re.I)
_NAME_SHAPE = re.compile(r"[^\W\d_][^\W\d_ .,'-]*(?:[ ,.'-]+[^\W\d_][^\W\d_ .,'-]*){1,5}\.?")
_BIRTH_LABEL = re.compile(r"\b(?:dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date)\s*[:#]?\s*(.{6,40})", re.I)
MAX_FOUND = 5


def find_patient(pages: list[tuple[int, str]], today: date) -> dict:
    """Distinct names and birth dates printed under a patient label, each with its page."""
    names: dict[str, int] = {}
    births: dict[str, dict] = {}
    for line in to_lines(pages):
        if len(names) < MAX_FOUND and (m := _NAME_LABEL.match(line.text)):
            value = _NAME_STOP.sub("", m[1]).strip(" ,;")
            if _NAME_SHAPE.fullmatch(value):
                names.setdefault(value, line.page)
        if len(births) < MAX_FOUND and (m := _BIRTH_LABEL.search(line.text)):
            found = find_dates(m[1], today)
            if found:
                first = found[0]
                # A date like 03/04/1971 reads two ways, and either might be the printed meaning.
                births.setdefault(first.iso, {"value": first.iso, "other": first.ambiguous, "page": line.page})
    return {"names": [{"value": value, "page": page} for value, page in names.items()], "births": list(births.values())}
