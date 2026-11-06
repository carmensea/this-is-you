"""Connecting, synchronizing and disconnecting providers. Read-only: nothing here writes to a provider.

Safeguards, in order of importance:
- Nothing is imported until the person confirms that the provider's patient is them, and again if that patient changes.
- Every provider record version is kept exactly as received. A changed record adds a version; none is replaced.
- Results arrive as proposals in the existing review. A verified result is never changed by a synchronization.
- Logs and stored messages hold counts and reasons, never record contents or tokens.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import httpx
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from .. import identity
from ..config import Settings
from ..documents import record_upload, utc_now
from ..models import (
    FhirResource,
    Observation,
    ObservationExtraction,
    ObservationOrigin,
    ObservationRevision,
    ObservationVerification,
    ProviderConnection,
    RevisionAction,
    SyncRun,
)
from ..observations import _derive, _revise
from ..storage import OriginalStore, UploadRejected
from . import smart
from .client import FILE_LIMIT, ProviderClient, ProviderError, RefusedAddress, check_address
from .keys import ConnectorKeys, TokensUnreadable
from . import providers as provider_list
from .providers import AVAILABLE, SANDBOX_MARKER, Provider

log = logging.getLogger("this_is_you.connectors")

CALLBACK_PATH = "/api/connections/callback"
PENDING_SECONDS = 600
MAX_PENDING = 20
MAX_PAGES = 100
PAGE_SIZE = 100
_PATIENT_ID = re.compile(r"^[A-Za-z0-9\-.]{1,128}$")

CONNECTED = "connected"
AWAITING_CONFIRMATION = "awaiting_confirmation"
NEEDS_SIGN_IN = "needs_sign_in"
DISCONNECTED = "disconnected"

MAPPED_STATUSES = {"final", "amended", "corrected", "preliminary"}


class Superseded(Exception):
    """The connection was disconnected or signed in again while this work was under way. It stops, writing nothing."""


class ConnectorProblem(Exception):
    """A refusal the person should see. Safe to show: no record contents, no tokens."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass
class Connectors:
    """What the running service holds for connections. Sign-ins in progress live only here, in memory."""

    settings: Settings
    sessions: sessionmaker[Session]
    store: OriginalStore
    read_document: Callable[[str], None]
    transport: httpx.BaseTransport | None = None
    sleep: Callable[[float], None] = time.sleep
    pending: dict[str, smart.Pending] = field(default_factory=dict)
    busy: set[str] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock)
    guards: dict[str, threading.Lock] = field(default_factory=dict)
    providers: tuple[Provider, ...] = ()
    provider_file_problem: str | None = None

    def __post_init__(self) -> None:
        # Read once, when the service starts: a change to the file takes effect at the next start.
        self.providers, self.provider_file_problem = provider_list.load(self.settings.data_dir)
        if self.provider_file_problem:
            log.warning("connector provider file not used: %s", self.provider_file_problem)

    def find(self, key: str) -> Provider | None:
        return next((p for p in self.providers if p.key == key), None)

    def guard(self, key: str) -> threading.Lock:
        """Held for every write of one provider's tokens or records, and by disconnecting, so they never interleave."""
        with self.lock:
            return self.guards.setdefault(key, threading.Lock())

    @property
    def keys(self) -> ConnectorKeys:
        return ConnectorKeys(self.settings.data_dir)

    def client(self, provider: Provider) -> ProviderClient:
        return ProviderClient(provider, self.transport, self.sleep)


def client_id_for(settings: Settings, provider: Provider) -> str | None:
    return {"epic_nonproduction": settings.epic_nonproduction_client_id, "epic_production": settings.epic_production_client_id}.get(provider.client)


def redirect_uri(settings: Settings) -> str:
    if settings.connector_redirect_uri:
        return settings.connector_redirect_uri
    return (settings.public_origin + CALLBACK_PATH) if settings.public_origin else f"http://127.0.0.1:5180{CALLBACK_PATH}"


def allowed_here(settings: Settings, provider: Provider) -> bool:
    """Fictional records and real ones never share an archive: a sandbox archive reads only the sandbox, and the reverse."""
    return provider.fictional_only == (settings.data_dir / SANDBOX_MARKER).is_file()


def _connectable(c: Connectors, key: str) -> tuple[Provider, str]:
    provider = c.find(key)
    if provider is None:
        raise ConnectorProblem(404, "unknown_provider", "This provider is not known.")
    if provider.state != AVAILABLE:
        raise ConnectorProblem(409, "planned", f"{provider.name} is planned, and cannot be connected yet.")
    if not allowed_here(c.settings, provider):
        raise ConnectorProblem(409, "wrong_archive", f"{provider.name} holds only fictional patients, so it connects only from a separate sandbox archive, never this one."
                               if provider.fictional_only else f"This is a sandbox archive for fictional records, so {provider.name} cannot be connected here.")
    client_id = client_id_for(c.settings, provider)
    if not client_id:
        raise ConnectorProblem(409, "not_registered", "No client ID is set for this provider. See Connected sources in the README.")
    return provider, client_id


# --- Signing in -----------------------------------------------------------------------------------------------------


def start(c: Connectors, key: str) -> str:
    """Where to send the person to sign in. They type their password at the provider, never here."""
    provider, client_id = _connectable(c, key)
    client = c.client(provider)
    try:
        endpoints = smart.discover(client)
    except ProviderError as problem:
        raise ConnectorProblem(502, "provider_unavailable", str(problem)) from None
    finally:
        client.close()
    verifier, challenge = smart.pkce_pair()
    state = secrets.token_urlsafe(32)
    uri = redirect_uri(c.settings)
    with c.lock:
        now = time.time()
        for old in [s for s, p in c.pending.items() if now - p.created > PENDING_SECONDS]:
            del c.pending[old]
        if len(c.pending) >= MAX_PENDING:
            raise ConnectorProblem(429, "too_many", "Too many sign-ins are in progress. Wait a few minutes.")
        c.pending[state] = smart.Pending(key, verifier, uri, now)
    return smart.authorize_url(provider, endpoints, client_id, uri, state, challenge)


def _take_pending(c: Connectors, state: str | None) -> smart.Pending | None:
    if not state:
        return None
    with c.lock:
        pending = c.pending.pop(state, None)  # Single use, whatever happens next.
    if pending is None or time.time() - pending.created > PENDING_SECONDS:
        return None
    return pending


def _patient_summary(patient: dict) -> tuple[str | None, str | None]:
    names = patient.get("name") or []
    chosen = next((n for n in names if n.get("use") == "official"), names[0] if names else None)
    name = None
    if chosen:
        name = chosen.get("text") or " ".join([*chosen.get("given", []), chosen.get("family", "")]).strip() or None
    birth = patient.get("birthDate")
    return name, (birth[:10] if isinstance(birth, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", birth[:10]) else None)


def _assess(c: Connectors, name: str | None, birth: str | None) -> identity.Assessment:
    found = {"names": [{"value": name}] if name else [], "births": [{"value": birth}] if birth else []}
    return identity.assess(identity.load_profile(c.sessions), found)


def _fetch_patient(client: ProviderClient, token: str, patient_id: str) -> dict:
    answer = client.get_record(f"{client.provider.fhir_base}/Patient/{patient_id}", token)
    if answer.status != 200:
        raise ProviderError("The patient record could not be read.", answer.status)
    patient = answer.json()
    if patient.get("resourceType") != "Patient" or patient.get("id") != patient_id:
        raise ProviderError("The provider returned a different patient record than the one signed in.")
    return patient


def finish(c: Connectors, code: str | None, state: str | None, error: str | None) -> str:
    """Completes a sign-in. Returns a short result code for the page; never raises to the browser."""
    pending = _take_pending(c, state)
    if pending is None:
        return "expired"
    if error or not code:
        return "declined" if error == "access_denied" else "failed"
    provider, client_id = _connectable(c, pending.provider_key)
    client = c.client(provider)
    try:
        endpoints = smart.discover(client)
        tokens = smart.exchange_code(client, c.keys, endpoints, client_id, code, pending)
        patient_id = tokens.get("patient")
        if not isinstance(patient_id, str) or not _PATIENT_ID.fullmatch(patient_id):
            return "no_patient"
        patient = _fetch_patient(client, tokens["access_token"], patient_id)
    except ProviderError as problem:
        log.warning("sign-in with %s failed: %s", provider.key, problem)
        return "failed"
    finally:
        client.close()
    name, birth = _patient_summary(patient)
    assessment = _assess(c, name, birth)
    now = utc_now()
    with c.guard(provider.key), c.sessions() as session:
        row = session.scalar(select(ProviderConnection).where(ProviderConnection.provider_key == provider.key))
        if row is None:
            row = ProviderConnection(provider_key=provider.key, fhir_base=provider.fhir_base, status=AWAITING_CONFIRMATION, updated_at=now)
            session.add(row)
            session.flush()
        same_person = row.confirmed_patient_fhir_id == patient_id and (row.patient_name, row.patient_birth_date) == (name, birth)
        earlier = row.confirmed_patient_fhir_id
        row.fhir_base, row.patient_fhir_id, row.patient_name, row.patient_birth_date = provider.fhir_base, patient_id, name, birth
        row.identity_status, row.scope = assessment.status, tokens.get("scope")
        # Sealed before anything is assigned, so a failure here changes nothing. A sync still running on the old sign-in is now stale.
        row.token_ciphertext, row.token_generation = c.keys.seal(tokens, row.id), (row.token_generation or 0) + 1
        row.connected_at, row.disconnected_at, row.updated_at = now, None, now
        if same_person:
            row.status, row.identity_reason = CONNECTED, assessment.reason
        else:
            row.status = AWAITING_CONFIRMATION
            row.identity_reason = (
                "This sign-in is for a different patient record than the one confirmed before. Nothing is imported until you confirm."
                if earlier else assessment.reason
            )
        session.commit()
    log.info("connected %s", provider.key)
    return "connected"


def confirm_identity(c: Connectors, key: str, patient_fhir_id: str) -> None:
    """The person says the provider's patient is them. Must name the patient they were shown, so a later change is not confirmed blind."""
    with c.sessions() as session:
        row = _row(session, key)
        if row.status != AWAITING_CONFIRMATION or row.patient_fhir_id != patient_fhir_id:
            raise ConnectorProblem(409, "changed", "This connection changed. Look at it again before confirming.")
        row.confirmed_patient_fhir_id, row.status, row.updated_at = row.patient_fhir_id, CONNECTED, utc_now()
        session.commit()


def _row(session: Session, key: str) -> ProviderConnection:
    row = session.scalar(select(ProviderConnection).where(ProviderConnection.provider_key == key))
    if row is None:
        raise ConnectorProblem(404, "not_connected", "This provider has never been connected.")
    return row


# --- Disconnecting --------------------------------------------------------------------------------------------------


def disconnect(c: Connectors, key: str) -> bool:
    """Ends the permission. Imported records stay unless deleted separately. True if the provider confirmed the revocation."""
    provider = c.find(key)
    # First, and authoritatively: the tokens go and the generation moves on, so no running sync can write again.
    # The guard waits for a refresh under way, so the tokens read here are the newest, and those are the ones revoked.
    with c.guard(key), c.sessions() as session:
        row = _row(session, key)
        sealed, row_id = row.token_ciphertext, row.id
        now = utc_now()
        row.token_ciphertext, row.scope, row.status, row.disconnected_at, row.updated_at = None, None, DISCONNECTED, now, now
        row.token_generation = (row.token_generation or 0) + 1
        session.commit()
    revoked = False
    if sealed and provider is not None:
        client_id = client_id_for(c.settings, provider)
        client = c.client(provider)
        try:
            tokens = c.keys.open(sealed, row_id)
            if client_id:
                revoked = smart.revoke(client, c.keys, smart.discover(client), client_id, tokens)
        except (TokensUnreadable, ProviderError):
            revoked = False
        finally:
            client.close()
    log.info("disconnected %s, revocation %s", key, "confirmed" if revoked else "not confirmed")
    return revoked


def delete_imported(c: Connectors, key: str) -> dict:
    """Deletes what this connection imported: provider records and the results read from them, verified or not.

    Only after disconnecting, and only when asked. PDF documents it stored stay, since another import may share them;
    they can be deleted one by one from Documents.
    """
    with c.sessions() as session:
        row = _row(session, key)
        if row.status != DISCONNECTED:
            raise ConnectorProblem(409, "still_connected", "Disconnect first. Then the imported records can be deleted.")
        resource_ids = select(FhirResource.id).where(FhirResource.connection_id == row.id)
        observation_ids = select(Observation.id).where(Observation.fhir_resource_id.in_(resource_ids))
        results = session.scalar(select(func.count()).select_from(Observation).where(Observation.fhir_resource_id.in_(resource_ids)))
        records = session.scalar(select(func.count()).select_from(FhirResource).where(FhirResource.connection_id == row.id))
        session.execute(delete(ObservationRevision).where(ObservationRevision.observation_id.in_(observation_ids)))
        session.execute(delete(Observation).where(Observation.fhir_resource_id.in_(resource_ids)))
        session.execute(delete(FhirResource).where(FhirResource.connection_id == row.id))
        row.updated_at = utc_now()
        session.commit()
    return {"records": records or 0, "results": results or 0}


# --- Synchronizing --------------------------------------------------------------------------------------------------


def mark_interrupted(sessions: sessionmaker[Session]) -> None:
    """A run still marked running at start-up stopped with the service. What it saved stays, and the next run continues."""
    with sessions() as session:
        for run in session.scalars(select(SyncRun).where(SyncRun.status == "running")):
            run.status, run.finished_at = "interrupted", utc_now()
            run.problems = [*run.problems, "Stopped before finishing, as the service stopped. Everything saved before that is kept."]
        session.commit()


def _canonical_sha(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass
class _Run:
    c: Connectors
    provider: Provider
    client: ProviderClient
    connection_id: str
    run_id: int
    patient_id: str
    tokens: dict
    client_id: str
    endpoints: smart.Endpoints
    generation: int
    counts: dict = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    def add(self, name: str, n: int = 1) -> None:
        self.counts[name] = self.counts.get(name, 0) + n

    def current(self, session: Session) -> bool:
        row = session.get(ProviderConnection, self.connection_id, populate_existing=True)
        return row is not None and row.status == CONNECTED and row.token_generation == self.generation

    def require_current(self, session: Session) -> None:
        if not self.current(session):
            raise Superseded()

    def renew(self) -> None:
        """Refreshes, then saves the result in one conditional write. A rolling refresh token replaces the old one there."""
        with self.c.guard(self.provider.key):
            with self.c.sessions() as session:
                self.require_current(session)
            renewed = smart.refresh(self.client, self.c.keys, self.endpoints, self.client_id, self.tokens)
            sealed = self.c.keys.seal(renewed, self.connection_id)  # Before writing, so a failure leaves the stored tokens as they were.
            with self.c.sessions() as session:
                written = session.execute(
                    update(ProviderConnection)
                    .where(ProviderConnection.id == self.connection_id, ProviderConnection.status == CONNECTED,
                           ProviderConnection.token_generation == self.generation)
                    .values(token_ciphertext=sealed, token_generation=self.generation + 1, updated_at=utc_now())
                ).rowcount
                if written != 1:
                    raise Superseded()
                session.commit()
            self.tokens, self.generation = renewed, self.generation + 1

    def get(self, url: str, accept: str = "application/fhir+json", limit: int | None = None):
        if self.tokens.get("expires_at", 0) - time.time() < 60:
            self.renew()
        kwargs = {"limit": limit} if limit else {}
        answer = self.client.get_record(url, self.tokens["access_token"], accept, **kwargs)
        if answer.status == 401:  # Expired early, or revoked. One renewal, then the person must sign in.
            self.renew()
            answer = self.client.get_record(url, self.tokens["access_token"], accept, **kwargs)
        return answer


def _store(session: Session, run: _Run, body: dict) -> tuple[FhirResource, bool, bool]:
    """Keeps this exact version. Returns the row, whether it is new, and whether an earlier version existed."""
    kind, fhir_id = str(body.get("resourceType")), str(body.get("id"))
    sha = _canonical_sha(body)
    found = session.scalar(select(FhirResource).where(FhirResource.connection_id == run.connection_id, FhirResource.resource_type == kind,
                                                      FhirResource.fhir_id == fhir_id, FhirResource.content_sha256 == sha))
    if found is not None:
        return found, False, False
    earlier = session.scalar(select(FhirResource.id).where(FhirResource.connection_id == run.connection_id, FhirResource.resource_type == kind,
                                                           FhirResource.fhir_id == fhir_id).limit(1)) is not None
    meta = body.get("meta") or {}
    row = FhirResource(connection_id=run.connection_id, sync_run_id=run.run_id, resource_type=kind[:40], fhir_id=fhir_id[:128],
                       version_id=str(meta["versionId"])[:64] if meta.get("versionId") else None,
                       last_updated=str(meta["lastUpdated"])[:40] if meta.get("lastUpdated") else None,
                       content_sha256=sha, body=body, fetched_at=utc_now())
    session.add(row)
    session.flush()
    return row, True, earlier


def _date(value: object) -> str | None:
    return value[:10] if isinstance(value, str) and re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", value[:10]) and len(value[:10]) == 10 else None


def _text(value: object, limit: int) -> str | None:
    return " ".join(str(value).split())[:limit] or None if value not in (None, "") else None


def _number_text(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return format(value, "g") if isinstance(value, float) and not value.is_integer() else str(int(value)) if float(value).is_integer() else str(value)


def _observation_fields(body: dict) -> dict | None:
    """What a result says, in the archive's terms. None when there is no single value to review."""
    code = body.get("code") or {}
    coding = code.get("coding") or [{}]
    name = _text(code.get("text") or coding[0].get("display") or coding[0].get("code"), 200)
    if not name:
        return None
    unit = None
    if "valueQuantity" in body:
        q = body["valueQuantity"] or {}
        number = _number_text(q.get("value"))
        if number is None:
            return None
        value = (q.get("comparator") or "") + number
        unit = _text(q.get("unit") or q.get("code"), 40)
    elif "valueString" in body:
        value = _text(body["valueString"], 60)
    elif "valueCodeableConcept" in body:
        concept = body["valueCodeableConcept"] or {}
        value = _text(concept.get("text") or ((concept.get("coding") or [{}])[0]).get("display"), 60)
    else:
        return None
    if not value:
        return None
    ranges = body.get("referenceRange") or []
    reference = None
    if ranges:
        r = ranges[0]
        low, high = _number_text((r.get("low") or {}).get("value")), _number_text((r.get("high") or {}).get("value"))
        reference = _text(r.get("text"), 60) or (f"{low}-{high}" if low and high else f">={low}" if low else f"<={high}" if high else None)
    interpretation = (body.get("interpretation") or [{}])[0]
    flag = _text(((interpretation.get("coding") or [{}])[0]).get("code") or interpretation.get("text"), 12)
    performer = (body.get("performer") or [{}])[0]
    effective = body.get("effectiveDateTime") or (body.get("effectivePeriod") or {}).get("start")
    return {"name": name, "value": value, "unit": unit, "reference": reference, "flag": flag,
            "lab": _text(performer.get("display"), 255), "collected": _date(effective), "reported": _date(body.get("issued"))}


def _propose(session: Session, run: _Run, resource: FhirResource, changed: bool) -> None:
    body = resource.body
    status = body.get("status")
    if status not in MAPPED_STATUSES:
        run.add("results_not_final")
        return
    fields = _observation_fields(body)
    if fields is None:
        run.add("results_without_value")
        return
    issues = []
    if not fields["collected"]:
        issues.append("The provider gave no collection date, so this will not be graphed until one is added.")
    if changed:
        issues.append("This result changed at the provider. The earlier version and any decision on it are kept unchanged.")
    if status == "preliminary":
        issues.append("The provider marks this result preliminary.")
    o = Observation(
        document_id=None, origin=ObservationOrigin.FHIR, extraction_status=ObservationExtraction.PARSED,
        verification_status=ObservationVerification.PROPOSED, confidence=None,
        reported_name=fields["name"], value_text=fields["value"], unit=fields["unit"], reference_text=fields["reference"], flag=fields["flag"],
        lab_name=fields["lab"], collected_on=fields["collected"], reported_on=fields["reported"],
        # When the provider documented it is not stated in a result, so it stays unknown. The fetch time is never used as a clinical date.
        documented_on=None, imported_at=resource.fetched_at, source_text=f"{run.provider.name}: Observation {resource.fhir_id}"[:200],
        issues=issues, fhir_resource_id=resource.id,
    )
    _derive(o)
    session.add(o)
    _revise(session, o, RevisionAction.IMPORTED)
    run.add("results_proposed")


def _attachment_url(run: _Run, raw: str) -> str:
    url = raw if "://" in raw else f"{run.provider.fhir_base}/{raw.lstrip('/')}"
    return check_address(run.provider, url, under_base=True)


def _store_document(run: _Run, resource: FhirResource) -> None:
    body = resource.body
    for content in body.get("content") or []:
        attachment = content.get("attachment") or {}
        if (attachment.get("contentType") or "").split(";")[0].strip().lower() != "application/pdf":
            run.add("notes_kept_as_records_only")
            continue
        if not attachment.get("url"):
            continue
        try:
            answer = run.get(_attachment_url(run, str(attachment["url"])), accept="application/pdf", limit=FILE_LIMIT)
        except RefusedAddress:
            run.add("attachments_refused")
            run.problems.append("An attachment pointed outside the provider's records and was not fetched.")
            continue
        if answer.status != 200:
            run.add("attachments_failed")
            continue
        data = answer.body
        if answer.content_type.startswith(("application/fhir+json", "application/json")):
            import base64

            try:
                data = base64.b64decode(answer.json().get("data") or "", validate=True)
            except (ValueError, ProviderError):
                run.add("attachments_failed")
                continue

        async def chunks():
            yield data

        try:
            received = asyncio.run(run.c.store.receive_pdf(chunks(), run.c.settings.max_upload_bytes))
        except UploadRejected:
            run.add("attachments_not_pdf")
            continue
        dated = _date(body.get("date")) or "undated"
        name = f"{run.provider.name} clinical document {dated}.pdf"
        with run.c.guard(run.provider.key):
            with run.c.sessions() as session:
                if not run.current(session):
                    received.temp_path.unlink(missing_ok=True)
                    raise Superseded()
            document, duplicate = record_upload(run.c.sessions, run.c.store, received, name)
            with run.c.sessions() as session:
                row = session.get(FhirResource, resource.id)
                row.document_id = row.document_id or document.id
                session.commit()
        if duplicate:
            run.add("documents_already_stored")
        else:
            run.add("documents_stored")
            run.c.read_document(document.id)


def _search(run: _Run, kind: str, query: str, optional: bool) -> None:
    url = f"{run.provider.fhir_base}/{kind}?patient={run.patient_id}{query}&_count={PAGE_SIZE}"
    for _page in range(MAX_PAGES):
        answer = run.get(url)
        if answer.status in (400, 403, 404) and optional:
            run.problems.append(f"{kind} records are not available from this provider ({answer.status}).")
            return
        if answer.status != 200:
            raise ProviderError(f"{kind} records could not be read.", answer.status)
        bundle = answer.json()
        if bundle.get("resourceType") != "Bundle":
            raise ProviderError(f"{kind} search returned something other than a list.")
        documents: list[FhirResource] = []
        # The check and the page's writes share one guarded transaction: after a disconnect, nothing more is kept.
        with run.c.guard(run.provider.key), run.c.sessions() as session:
            run.require_current(session)
            for entry in bundle.get("entry") or []:
                body = entry.get("resource") or {}
                if body.get("resourceType") == "OperationOutcome":
                    run.add("provider_notes")
                    continue
                if body.get("resourceType") != kind or not isinstance(body.get("id"), str):
                    run.add("records_skipped")
                    continue
                if (body.get("subject") or body.get("patient") or {}).get("reference") not in (None, f"Patient/{run.patient_id}"):
                    run.add("records_for_another_patient")  # Never kept: this connection reads one patient only.
                    continue
                row, new, changed = _store(session, run, body)
                run.add(f"{kind}_received")
                if not new:
                    run.add(f"{kind}_unchanged")
                    continue
                run.add(f"{kind}_new_versions")
                if kind == "Observation":
                    _propose(session, run, row, changed)
                elif kind == "DocumentReference":
                    documents.append(row)
            session.commit()  # Page by page, so an interruption keeps what arrived.
        for row in documents:
            _store_document(run, row)
        following = next((link.get("url") for link in bundle.get("link") or [] if link.get("relation") == "next"), None)
        if not following:
            return
        url = check_address(run.provider, str(following), under_base=True)
    run.problems.append(f"Stopped reading {kind} after {MAX_PAGES} pages.")


def synchronize(c: Connectors, key: str) -> int:
    """One manual synchronization. Returns the run's ID; its status and counts say how it went."""
    provider, client_id = _connectable(c, key)
    with c.lock:
        if key in c.busy:
            raise ConnectorProblem(409, "busy", "This provider is already synchronizing.")
        c.busy.add(key)
    try:
        return _synchronize(c, provider, client_id)
    finally:
        with c.lock:
            c.busy.discard(key)


def _synchronize(c: Connectors, provider: Provider, client_id: str) -> int:
    with c.sessions() as session:
        row = _row(session, provider.key)
        if row.status == AWAITING_CONFIRMATION:
            raise ConnectorProblem(409, "awaiting_confirmation", "Confirm that this patient record is yours before anything is imported.")
        if row.status != CONNECTED or not row.token_ciphertext or row.fhir_base != provider.fhir_base:
            raise ConnectorProblem(409, "needs_sign_in", "Sign in to this provider again.")
        run_row = SyncRun(connection_id=row.id, status="running", started_at=utc_now(), counts={}, problems=[])
        session.add(run_row)
        session.commit()
        connection_id, sealed, patient_id, run_id = row.id, row.token_ciphertext, row.patient_fhir_id, run_row.id
        confirmed, generation = (row.patient_name, row.patient_birth_date), row.token_generation
    client = c.client(provider)
    run: _Run | None = None
    status, problems, counts = "failed", [], {}
    try:
        tokens = c.keys.open(sealed, connection_id)
        run = _Run(c, provider, client, connection_id, run_id, patient_id, tokens, client_id, smart.discover(client), generation)
        patient_answer = run.get(f"{provider.fhir_base}/Patient/{patient_id}")
        if patient_answer.status != 200:
            raise ProviderError("The patient record could not be read.", patient_answer.status)
        patient = patient_answer.json()
        if patient.get("id") != patient_id or _patient_summary(patient) != confirmed:
            with c.guard(provider.key), c.sessions() as session:
                run.require_current(session)
                row = session.get(ProviderConnection, connection_id)
                row.patient_name, row.patient_birth_date = _patient_summary(patient)
                row.status, row.updated_at = AWAITING_CONFIRMATION, utc_now()
                row.identity_reason = "The provider's patient details changed since you confirmed them. Nothing was imported. Look and confirm again."
                session.commit()
            problems = ["The patient details changed at the provider. Nothing was imported."]
            status = "held"
            return run_id
        with c.guard(provider.key), c.sessions() as session:
            run.require_current(session)
            _store(session, run, patient)
            session.commit()
        _search(run, "Observation", "&category=laboratory", optional=False)
        _search(run, "DiagnosticReport", "", optional=True)
        _search(run, "DocumentReference", "&category=clinical-note", optional=True)
        status = "partial" if run.problems else "completed"
    except Superseded:
        status = "stopped"
        problems.append("Disconnected or signed in again during this synchronization, so it stopped. Nothing more was imported.")
    except TokensUnreadable:
        _needs_sign_in(c, provider.key, connection_id, generation)
        problems.append("The saved permission cannot be read on this computer, as after a restore. Sign in again.")
    except ProviderError as problem:
        if problem.code == "invalid_grant" or problem.status == 401:
            _needs_sign_in(c, provider.key, connection_id, run.generation if run else generation)
        problems.append(str(problem) + (f" ({problem.status})" if problem.status else ""))
    except Exception as problem:
        # Only the kind of error: its message could quote something the provider sent.
        log.error("synchronizing %s stopped: %s", provider.key, type(problem).__name__)
        problems.append("Stopped by an unexpected error. Everything saved before it is kept.")
    finally:
        client.close()
        if run is not None:
            problems, counts = run.problems + problems, run.counts
        with c.sessions() as session:
            done = session.get(SyncRun, run_id)
            done.status, done.finished_at, done.counts, done.problems = status, utc_now(), counts, problems[:20]
            session.commit()
        log.info("synchronized %s: %s", provider.key, status)
    return run_id


def _needs_sign_in(c: Connectors, key: str, connection_id: str, generation: int) -> None:
    """Only a connection still on the tokens that failed: a disconnect or a new sign-in in the meantime stays as it is."""
    with c.guard(key), c.sessions() as session:
        session.execute(
            update(ProviderConnection)
            .where(ProviderConnection.id == connection_id, ProviderConnection.status == CONNECTED, ProviderConnection.token_generation == generation)
            .values(status=NEEDS_SIGN_IN, token_ciphertext=None, token_generation=generation + 1, updated_at=utc_now())
        )
        session.commit()


# --- Listing --------------------------------------------------------------------------------------------------------


def overview(c: Connectors) -> list[dict]:
    with c.sessions() as session:
        rows = {r.provider_key: r for r in session.scalars(select(ProviderConnection))}
        out = []
        for p in c.providers:
            row = rows.get(p.key)
            entry = {
                "key": p.key, "name": p.name, "place": p.place, "organization_id": p.organization_id, "fhir_base": p.fhir_base,
                "state": p.state, "note": p.note, "registered": bool(client_id_for(c.settings, p)), "allowed_here": allowed_here(c.settings, p),
                "connection": None,
            }
            if row is not None:
                runs = list(reversed(row.runs[-5:]))
                imported = session.scalars(select(FhirResource.resource_type).where(FhirResource.connection_id == row.id)).all()
                by_type: dict[str, int] = {}
                for kind in imported:
                    by_type[kind] = by_type.get(kind, 0) + 1
                entry["connection"] = {
                    "status": row.status, "patient_fhir_id": row.patient_fhir_id, "patient_name": row.patient_name,
                    "patient_birth_date": row.patient_birth_date, "identity_status": row.identity_status, "identity_reason": row.identity_reason,
                    "connected_at": row.connected_at, "disconnected_at": row.disconnected_at,
                    "record_versions": by_type,
                    "runs": [{"id": r.id, "status": r.status, "started_at": r.started_at, "finished_at": r.finished_at,
                              "counts": r.counts, "problems": r.problems} for r in runs],
                }
            out.append(entry)
    return out
