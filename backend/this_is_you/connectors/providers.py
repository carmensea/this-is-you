"""The only providers this archive will talk to. Addresses come from here, never from a request or a server's answer.

The code lists only Epic's public sandbox. A real health system is the person's own choice, so it is configured in a file
beside their archive, `connector-providers.json`, and never in this repository:

    {"providers": [{"key": "my-clinic", "name": "Fictional Health System", "place": "Example City",
                    "fhir_base": "https://fhir.example.com/api/FHIR/R4", "organization_id": "12345", "state": "planned"}]}

Check a base address against Epic's published endpoint list and the provider's own discovery document before adding it.
Messages about the file never repeat what it holds, so a log or a screen cannot show which provider someone uses.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

AVAILABLE = "available"
PLANNED = "planned"  # Shown, never connectable. Production use needs its own registration and approval.

LOCAL_FILE = "connector-providers.json"
MAX_FILE_BYTES = 64 * 1024
MAX_PROVIDERS = 10


@dataclass(frozen=True)
class Provider:
    key: str
    name: str
    place: str
    fhir_base: str
    state: str
    client: str  # Which registered client ID it uses: Epic's non-production one for the sandbox, the production one for health systems.
    organization_id: str | None = None
    note: str | None = None
    # Only connectable from an archive marked as a sandbox, and such an archive connects to nothing else.
    fictional_only: bool = False

    @property
    def host(self) -> str:
        return urlsplit(self.fhir_base).hostname or ""


SANDBOX = Provider(
    key="epic-sandbox",
    name="Epic sandbox",
    place="Fictional test patients from Epic on FHIR",
    fhir_base="https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    state=AVAILABLE,
    client="epic_nonproduction",
    note="For testing. Holds only Epic's fictional patients.",
    fictional_only=True,
)
BUILT_IN: tuple[Provider, ...] = (SANDBOX,)

# A file in an archive's folder that marks it as a throwaway sandbox installation. A real archive never has one.
SANDBOX_MARKER = "SANDBOX-ONLY-FICTIONAL-RECORDS"


class ProviderFileProblem(Exception):
    """Why the local provider file was not used. Says what is wrong, never what the file holds."""


_FIELDS = {"key", "name", "place", "fhir_base", "organization_id", "note", "state"}
_KEY = re.compile(r"[a-z0-9][a-z0-9-]{1,39}")
_ORGANIZATION = re.compile(r"[0-9]{1,10}")
_HOSTNAME = re.compile(r"(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
_FHIR_PATH = re.compile(r"(/[A-Za-z0-9._~-]+)*/FHIR/R4")
_PRIVATE_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".arpa", ".invalid", ".test", ".example")


def safe_base(url: str) -> bool:
    """An HTTPS address on a public name, with nothing in it that could send a request or a credential somewhere else."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    host = parts.hostname or ""
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443) or parts.query or parts.fragment:
        return False
    if url != f"https://{parts.netloc}{parts.path}" or parts.netloc.lower() != parts.netloc or not _FHIR_PATH.fullmatch(parts.path):
        return False
    try:
        ipaddress.ip_address(host.strip("[]"))
        return False  # An address, not a name: no certificate a provider would hold, and a way to reach this machine's network.
    except ValueError:
        pass
    return bool(_HOSTNAME.fullmatch(host)) and not host.endswith(_PRIVATE_SUFFIXES)


def _text(entry: dict, field: str, limit: int, required: bool) -> str | None:
    value = entry.get(field)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(ch) < 32 for ch in value):
        raise ProviderFileProblem(f"A provider's {field} is missing or not plain text of at most {limit} characters.")
    return value.strip()


def _provider(entry: object) -> Provider:
    if not isinstance(entry, dict) or not set(entry) <= _FIELDS:
        raise ProviderFileProblem(f"Each provider may only have these fields: {', '.join(sorted(_FIELDS))}.")
    key = _text(entry, "key", 40, True)
    if not _KEY.fullmatch(key) or key == SANDBOX.key:
        raise ProviderFileProblem("A provider's key must be lowercase letters, digits and hyphens, and not a built-in key.")
    fhir_base = _text(entry, "fhir_base", 300, True).rstrip("/")
    if not safe_base(fhir_base):
        raise ProviderFileProblem("A provider's address must be an https FHIR R4 base on a public host name, with no port, query or login.")
    organization_id = _text(entry, "organization_id", 10, False)
    if organization_id is not None and not _ORGANIZATION.fullmatch(organization_id):
        raise ProviderFileProblem("A provider's organization_id must be digits only.")
    state = entry.get("state", PLANNED)
    if state not in (PLANNED, AVAILABLE):
        raise ProviderFileProblem('A provider\'s state must be "planned" or "available".')
    return Provider(
        key=key, name=_text(entry, "name", 80, True), place=_text(entry, "place", 120, False) or "", fhir_base=fhir_base, state=state,
        client="epic_production", organization_id=organization_id, note=_text(entry, "note", 200, False),
    )


def read_local(data_dir: Path) -> tuple[Provider, ...]:
    """The person's own providers, or none if there is no file. Raises ProviderFileProblem if one is there but unsafe."""
    path = data_dir / LOCAL_FILE
    try:
        info = path.lstat()
    except FileNotFoundError:
        return ()
    if not stat.S_ISREG(info.st_mode):
        raise ProviderFileProblem(f"{LOCAL_FILE} must be an ordinary file, not a link or a folder.")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise ProviderFileProblem(f"{LOCAL_FILE} must belong to the account the service runs as.")
    if info.st_mode & 0o077:
        raise ProviderFileProblem(f"{LOCAL_FILE} can be read or changed by other accounts. Run: chmod 600 {LOCAL_FILE}")
    if info.st_size > MAX_FILE_BYTES:
        raise ProviderFileProblem(f"{LOCAL_FILE} is larger than {MAX_FILE_BYTES // 1024} KB.")
    try:
        data = json.loads(path.read_bytes())
    except (OSError, ValueError):
        raise ProviderFileProblem(f"{LOCAL_FILE} could not be read as JSON.") from None
    entries = data.get("providers") if isinstance(data, dict) and set(data) == {"providers"} else None
    if not isinstance(entries, list) or len(entries) > MAX_PROVIDERS:
        raise ProviderFileProblem(f'{LOCAL_FILE} must hold {{"providers": [...]}} with at most {MAX_PROVIDERS} providers.')
    found = tuple(_provider(entry) for entry in entries)
    if len({p.key for p in found}) != len(found):
        raise ProviderFileProblem("Two providers share a key.")
    return found


def load(data_dir: Path) -> tuple[tuple[Provider, ...], str | None]:
    """Built-in providers plus the person's own. An unsafe file is left out whole, and the reason is returned."""
    try:
        return BUILT_IN + read_local(data_dir), None
    except ProviderFileProblem as problem:
        return BUILT_IN, str(problem)
