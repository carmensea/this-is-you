"""Compares what a document prints under a patient label with the details a person entered.

The result is only ever a suggestion. Nothing here refuses, deletes, verifies or hides a document, and the
details never reach the document reader: it reports what is printed, and this compares afterwards.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy.orm import Session, sessionmaker

from .models import IdentityProfile

_SKIP = {"mr", "mrs", "ms", "mx", "dr", "jr", "sr", "ii", "iii", "iv"}

NOT_CONFIGURED = "not_configured"
UNDETERMINED = "undetermined"
POSSIBLE_MATCH = "possible_match"
POSSIBLE_MISMATCH = "possible_mismatch"


@dataclass(frozen=True)
class Profile:
    names: tuple[str, ...]  # Current name first, then any earlier ones.
    date_of_birth: str | None


@dataclass(frozen=True)
class Assessment:
    status: str
    reason: str
    names_found: list[str] = field(default_factory=list)
    birth_dates_found: list[str] = field(default_factory=list)


def load_profile(sessions: sessionmaker[Session]) -> Profile | None:
    with sessions() as session:
        row = session.get(IdentityProfile, 1)
        return Profile((row.full_name, *row.previous_names), row.date_of_birth) if row else None


def _tokens(name: str) -> list[str]:
    plain = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)).casefold()
    return [t for t in re.split(r"[^\w']+|_", plain.replace("'", "")) if t and t not in _SKIP]


def names_agree(printed: str, known: str) -> bool:
    """Family and given name both appear, in either order. An initial is enough for the given name."""
    a, b = _tokens(printed), _tokens(known)
    if len(b) < 2 or not a:
        return False
    full = [t for t in a if len(t) > 1]
    initials = {t[0] for t in a}
    return b[-1] in full and (b[0] in full or b[0][0] in initials and len(full) == 1)


def assess(profile: Profile | None, found: dict | None) -> Assessment:
    names = [n["value"] for n in (found or {}).get("names", [])]
    births = (found or {}).get("births", [])
    shown = [b["value"] for b in births]
    if profile is None:
        return Assessment(NOT_CONFIGURED, "Your details are not set, so this was not compared.", names, shown)
    if found is None:
        return Assessment(UNDETERMINED, "Could not be determined: no readable text to compare.", names, shown)
    if not names and not births:
        return Assessment(UNDETERMINED, "Could not be determined: no patient name or birth date was recognized.", names, shown)
    other_names = [n for n in names if not any(names_agree(n, known) for known in profile.names)]
    other_births = [b for b in births if profile.date_of_birth and profile.date_of_birth not in (b["value"], b.get("other"))]
    if other_names or other_births:
        parts = ([f'prints the name "{other_names[0]}"'] if other_names else []) + ([f"prints the birth date {other_births[0]['value']}"] if other_births else [])
        return Assessment(POSSIBLE_MISMATCH, f"Check this document: it {' and '.join(parts)}, which differs from your details. It may belong to someone else, or the printing may differ.", names, shown)
    if names or (births and profile.date_of_birth):
        return Assessment(POSSIBLE_MATCH, "The printed patient details resemble yours. This is a suggestion, not verification.", names, shown)
    return Assessment(UNDETERMINED, "Could not be determined: a birth date is printed, but none is set in your details.", names, shown)
