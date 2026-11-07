"""Provider connections against a fake Epic: sign-in, identity, sync, versions, duplicates, failures and disconnecting.

Every patient, result and file here is fictional. No request leaves this process: the fake answers through MockTransport.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from urllib.parse import parse_qs, urlsplit

import httpcore
import httpcore._backends.sync
import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

from this_is_you.connectors import service
from this_is_you.connectors.client import ProviderClient, RefusedAddress, check_address
from this_is_you.connectors.keys import SIGNING_KEY, TOKEN_KEY, ConnectorKeys
from this_is_you.connectors import providers
from this_is_you.connectors.providers import SANDBOX, SANDBOX_MARKER

from .conftest import CLIENT_HEADERS, client_for, make_pdf

BASE = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
OAUTH = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2"
CLIENT_ID = "fictional-nonproduction-client"
PATIENT = "eFictionalPatient0001"


def _unpad(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def lab(fhir_id: str, value, unit="g/dL", name="Hemoglobin", day="2026-03-04", status="final", version="1", **extra) -> dict:
    body = {"resourceType": "Observation", "id": fhir_id, "meta": {"versionId": version, "lastUpdated": "2026-03-05T10:00:00Z"},
            "status": status, "category": [{"coding": [{"code": "laboratory"}]}], "code": {"text": name, "coding": [{"system": "http://loinc.org", "code": "718-7"}]},
            "subject": {"reference": f"Patient/{PATIENT}"}, "valueQuantity": {"value": value, "unit": unit},
            "referenceRange": [{"low": {"value": 12}, "high": {"value": 16}}], "issued": "2026-03-05T09:00:00Z", **extra}
    if day:
        body["effectiveDateTime"] = f"{day}T08:00:00Z"
    return body


class FakeEpic:
    """Just enough of Epic's sandbox. Checks PKCE and the signed client assertion like the real one would."""

    def __init__(self, keys: ConnectorKeys) -> None:
        self.keys = keys
        self.patient = {"resourceType": "Patient", "id": PATIENT, "name": [{"use": "official", "given": ["Avery"], "family": "Fictional"}], "birthDate": "1987-09-12"}
        self.labs: list[dict] = [lab("lab-1", 14.2), lab("lab-2", 5.1, unit="mmol/L", name="Potassium"), lab("lab-3", 92, unit="mg/dL", name="Glucose")]
        self.documents: list[dict] = []
        self.binaries: dict[str, bytes] = {}
        self.challenge: str | None = None
        self.codes: set[str] = set()
        self.refresh_ok = True
        # Rolling refresh tokens: each refresh issues a new one and the one it replaced stops working.
        self.issued = 0
        self.refresh_current: str | None = None
        self.refresh_used: list[str] = []
        self.rotate = True
        self.on_refresh = None
        self.on_page = None
        self.expires_in = 3600
        self.revoked: list[str] = []
        self.revoked_values: list[str] = []
        self.calls: list[str] = []
        self.fail_next: list[int] = []
        self.page_size = 2
        self.diagnostic_status = 200
        self.next_override: str | None = None
        self.token_patient = PATIENT

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(f"{request.method} {url}")
        if self.fail_next:
            return httpx.Response(self.fail_next.pop(0), headers={"retry-after": "0"})
        if url == BASE + "/.well-known/smart-configuration":
            return httpx.Response(200, json={"authorization_endpoint": OAUTH + "/authorize", "token_endpoint": OAUTH + "/token",
                                             "revocation_endpoint": OAUTH + "/revoke", "code_challenge_methods_supported": ["S256"]})
        if url == OAUTH + "/token":
            return self.token(parse_qs(request.content.decode()))
        if url == OAUTH + "/revoke":
            form = parse_qs(request.content.decode())
            self.revoked.append(form["token_type_hint"][0])
            self.revoked_values.append(form["token"][0])
            return httpx.Response(200)
        if request.headers.get("authorization") != "Bearer access-current":
            return httpx.Response(401)
        path, query = url[len(BASE):].split("?")[0], parse_qs(urlsplit(url).query)
        if path == f"/Patient/{self.patient['id']}":
            return httpx.Response(200, json=self.patient)
        if path == "/Observation":
            return self.page("Observation", self.labs, int(query.get("page", ["0"])[0]))
        if path == "/DiagnosticReport":
            return httpx.Response(self.diagnostic_status, json={"resourceType": "Bundle", "entry": []} if self.diagnostic_status == 200 else {"resourceType": "OperationOutcome"})
        if path == "/DocumentReference":
            return self.page("DocumentReference", self.documents, int(query.get("page", ["0"])[0]))
        if path.startswith("/Binary/") and path[8:] in self.binaries:
            return httpx.Response(200, content=self.binaries[path[8:]], headers={"content-type": "application/pdf"})
        return httpx.Response(404)

    def page(self, kind: str, items: list[dict], page: int) -> httpx.Response:
        if self.on_page:
            answer = self.on_page(kind, page)
            if answer is not None:
                return answer
        chunk = items[page * self.page_size:(page + 1) * self.page_size]
        links = []
        if (page + 1) * self.page_size < len(items):
            links.append({"relation": "next", "url": self.next_override or f"{BASE}/{kind}?patient={PATIENT}&page={page + 1}"})
        return httpx.Response(200, json={"resourceType": "Bundle", "link": links, "entry": [{"resource": r} for r in chunk]})

    def token(self, form: dict) -> httpx.Response:
        assertion = form["client_assertion"][0]
        head, claims, signature = assertion.split(".")
        self.keys.signing_key().public_key().verify(_unpad(signature), f"{head}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA384())
        claims = json.loads(_unpad(claims))
        assert claims["iss"] == claims["sub"] == CLIENT_ID and claims["aud"] == OAUTH + "/token" and claims["exp"] - claims["iat"] <= 300
        assert form["client_assertion_type"] == ["urn:ietf:params:oauth:client-assertion-type:jwt-bearer"]
        if form["grant_type"] == ["authorization_code"]:
            code = form["code"][0]
            verifier = form["code_verifier"][0]
            if code not in self.codes or base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode() != self.challenge:
                return httpx.Response(400, json={"error": "invalid_grant"})
            self.codes.discard(code)
            refresh = self.new_refresh()
        elif form["grant_type"] == ["refresh_token"]:
            self.refresh_used.append(form["refresh_token"][0])
            if self.on_refresh:
                self.on_refresh()
            if not self.refresh_ok or form["refresh_token"] != [self.refresh_current]:
                return httpx.Response(400, json={"error": "invalid_grant"})
            refresh = self.new_refresh() if self.rotate else None
        body = {"access_token": "access-current", "token_type": "Bearer", "expires_in": self.expires_in,
                "scope": "patient/Observation.read", "patient": self.token_patient}
        if refresh:
            body["refresh_token"] = refresh
        return httpx.Response(200, json=body)

    def new_refresh(self) -> str:
        self.issued += 1
        self.refresh_current = f"refresh-fictional-{self.issued}"
        return self.refresh_current


def sandbox_archive(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    (path / SANDBOX_MARKER).touch()
    return path


@pytest.fixture
def setup(data_dir):
    app_client = client_for(sandbox_archive(data_dir), epic_nonproduction_client_id=CLIENT_ID)
    connectors = app_client.app.state.connectors
    fake = FakeEpic(ConnectorKeys(data_dir))
    connectors.transport = httpx.MockTransport(fake.handle)
    connectors.sleep = lambda _seconds: None
    return app_client, fake


def set_identity(app_client, name="Avery Fictional", born="1987-09-12"):
    assert app_client.put("/api/identity", json={"full_name": name, "date_of_birth": born, "previous_names": []}, headers=CLIENT_HEADERS).status_code == 200


def sign_in(app_client, fake, code="code-1"):
    started = app_client.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS)
    assert started.status_code == 200, started.text
    query = parse_qs(urlsplit(started.json()["authorize_url"]).query)
    fake.challenge = query["code_challenge"][0]
    fake.codes.add(code)
    # The provider sends the browser back from its own site, so the strict session cookie is not sent.
    back = httpx.Client(transport=app_client._transport, base_url="http://localhost")
    return back.get(f"/api/connections/callback?code={code}&state={query['state'][0]}", headers={"sec-fetch-site": "cross-site"}), query


def returned(answer) -> str:
    """The fixed word the callback page sends back to the app, after checking it is that page."""
    assert answer.status_code == 200 and '<meta http-equiv="refresh"' in answer.text
    return re.search(r"result=([a-z_]+)", answer.text).group(1)


def connection(app_client) -> dict:
    return next(p for p in app_client.get("/api/connections").json()["providers"] if p["key"] == "epic-sandbox")["connection"]


def connect(app_client, fake):
    set_identity(app_client)
    back, _ = sign_in(app_client, fake)
    assert returned(back) == "connected"
    assert app_client.post("/api/connections/epic-sandbox/confirm-identity", json={"patient_fhir_id": PATIENT}, headers=CLIENT_HEADERS).status_code == 200


def sync(app_client):
    answer = app_client.post("/api/connections/epic-sandbox/sync", headers=CLIENT_HEADERS)
    assert answer.status_code == 200, answer.text
    return connection(app_client)["runs"][0]


def fhir_results(app_client):
    return [o for o in app_client.get("/api/observations").json()["observations"] if o["origin"] == "fhir"]


# --- Signing in ---


def test_sign_in_uses_pkce_state_and_the_registered_redirect(setup):
    app_client, fake = setup
    back, query = sign_in(app_client, fake)
    assert returned(back) == "connected"
    assert query["code_challenge_method"] == ["S256"] and query["client_id"] == [CLIENT_ID] and query["aud"] == [BASE]
    assert query["redirect_uri"] == ["http://127.0.0.1:5180/api/connections/callback"]
    assert "patient/Observation.read" in query["scope"][0] and not any(".write" in s for s in query["scope"][0].split())


def test_a_state_works_once_and_an_unknown_one_never(setup):
    app_client, fake = setup
    back, query = sign_in(app_client, fake)
    again = app_client.get(f"/api/connections/callback?code=code-1&state={query['state'][0]}", follow_redirects=False)
    assert returned(again) == "expired"
    assert returned(app_client.get("/api/connections/callback?code=x&state=made-up", follow_redirects=False)) == "expired"


def test_a_stale_sign_in_expires(setup, monkeypatch):
    app_client, fake = setup
    started = app_client.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS).json()
    state = parse_qs(urlsplit(started["authorize_url"]).query)["state"][0]
    real = time.time
    monkeypatch.setattr(service.time, "time", lambda: real() + service.PENDING_SECONDS + 1)
    assert returned(app_client.get(f"/api/connections/callback?code=c&state={state}", follow_redirects=False)) == "expired"


def test_a_declined_sign_in_stores_nothing(setup):
    app_client, fake = setup
    started = app_client.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS).json()
    state = parse_qs(urlsplit(started["authorize_url"]).query)["state"][0]
    assert returned(app_client.get(f"/api/connections/callback?error=access_denied&state={state}", follow_redirects=False)) == "declined"
    assert connection(app_client) is None


def test_the_callback_shows_nothing_from_the_provider(setup):
    app_client, fake = setup
    started = app_client.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS).json()
    state = parse_qs(urlsplit(started["authorize_url"]).query)["state"][0]
    back = app_client.get(f"/api/connections/callback?error=<script>&state={state}", follow_redirects=False)
    assert returned(back) == "failed"


def test_only_signed_in_people_can_start_or_read(data_dir):
    signed_out = client_for(data_dir, epic_nonproduction_client_id=CLIENT_ID)
    signed_out.cookies.clear()
    assert signed_out.get("/api/connections").status_code == 401
    assert signed_out.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS).status_code == 401


# A health system someone might use, invented. Real ones live only in the archive's own folder, never in this repository.
FICTIONAL_SYSTEM = {"key": "fictional-health", "name": "Fictional Health System", "place": "Example City",
                    "fhir_base": "https://fhir.example.com/interconnect/api/FHIR/R4", "organization_id": "4242", "state": "planned"}


def with_local_providers(path, entries=(FICTIONAL_SYSTEM,), mode=0o600):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    file = path / providers.LOCAL_FILE
    file.write_text(json.dumps({"providers": list(entries)}))
    file.chmod(mode)
    return path


def test_planned_and_unregistered_providers_cannot_connect(data_dir):
    app_client = client_for(with_local_providers(data_dir.parent / "real"), epic_production_client_id="fictional-production-client")
    planned = app_client.post("/api/connections/fictional-health/authorize", headers=CLIENT_HEADERS)
    assert planned.status_code == 409 and "planned" in planned.json()["message"]
    listed = {p["key"]: p for p in app_client.get("/api/connections").json()["providers"]}
    assert listed["fictional-health"]["state"] == "planned" and listed["fictional-health"]["connection"] is None
    assert listed["fictional-health"]["organization_id"] == "4242"
    bare = client_for(sandbox_archive(data_dir.parent / "other"))
    assert bare.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS).json()["code"] == "not_registered"


def test_the_code_names_no_real_health_system(data_dir):
    listed = client_for(data_dir.parent / "plain").get("/api/connections").json()
    assert [p["key"] for p in listed["providers"]] == ["epic-sandbox"] and listed["provider_file_problem"] is None


def test_the_sandbox_never_connects_from_a_real_archive(data_dir):
    real = client_for(with_local_providers(data_dir.parent / "real"), epic_nonproduction_client_id=CLIENT_ID)
    refused = real.post("/api/connections/epic-sandbox/authorize", headers=CLIENT_HEADERS)
    assert refused.status_code == 409 and refused.json()["code"] == "wrong_archive"
    listed = {p["key"]: p for p in real.get("/api/connections").json()["providers"]}
    assert listed["epic-sandbox"]["allowed_here"] is False and listed["fictional-health"]["allowed_here"] is True


def test_a_sandbox_archive_connects_to_nothing_real(data_dir):
    app_client = client_for(with_local_providers(sandbox_archive(data_dir)), epic_nonproduction_client_id=CLIENT_ID)
    listed = {p["key"]: p for p in app_client.get("/api/connections").json()["providers"]}
    assert listed["epic-sandbox"]["allowed_here"] is True and listed["fictional-health"]["allowed_here"] is False


@pytest.mark.parametrize("change", [
    {"fhir_base": "http://fhir.example.com/api/FHIR/R4"},
    {"fhir_base": "https://192.0.2.10/api/FHIR/R4"},
    {"fhir_base": "https://[2001:db8::1]/api/FHIR/R4"},
    {"fhir_base": "https://localhost/api/FHIR/R4"},
    {"fhir_base": "https://clinic.local/api/FHIR/R4"},
    {"fhir_base": "https://fhir.example.com:8443/api/FHIR/R4"},
    {"fhir_base": "https://someone:secret@fhir.example.com/api/FHIR/R4"},
    {"fhir_base": "https://fhir.example.com/api/FHIR/R4?next=elsewhere"},
    {"fhir_base": "https://fhir.example.com/api/FHIR/R4#x"},
    {"fhir_base": "https://fhir.example.com/upload"},
    {"fhir_base": "https://FHIR.example.com/api/FHIR/R4"},
    {"key": "epic-sandbox"},
    {"key": "Has Spaces"},
    {"organization_id": "12-34"},
    {"state": "connected"},
    {"client": "epic_nonproduction"},
    {"fictional_only": True},
    {"name": "Line\nbreak"},
])
def test_an_unsafe_provider_file_is_left_out_whole_and_never_quoted(data_dir, caplog, change):
    entry = {**FICTIONAL_SYSTEM, **change}
    with caplog.at_level(logging.INFO):
        listed = client_for(with_local_providers(data_dir.parent / "real", [FICTIONAL_SYSTEM | {"key": "fine-one"}, entry])).get("/api/connections").json()
    assert [p["key"] for p in listed["providers"]] == ["epic-sandbox"]
    told = listed["provider_file_problem"] + caplog.text
    assert listed["provider_file_problem"] and "provider file not used" in caplog.text
    for value in ("Fictional Health System", "Example City", "example.com", "4242", "secret", "192.0.2.10", "elsewhere"):
        assert value not in told


@pytest.mark.parametrize("mode", [0o644, 0o640, 0o602, 0o660])
def test_a_provider_file_others_can_read_or_change_is_not_used(data_dir, mode):
    listed = client_for(with_local_providers(data_dir.parent / "real", mode=mode)).get("/api/connections").json()
    assert [p["key"] for p in listed["providers"]] == ["epic-sandbox"] and "chmod 600" in listed["provider_file_problem"]


def test_a_linked_or_malformed_provider_file_is_not_used(data_dir, tmp_path):
    elsewhere = tmp_path / "elsewhere.json"
    elsewhere.write_text(json.dumps({"providers": [FICTIONAL_SYSTEM]}))
    elsewhere.chmod(0o600)
    real = data_dir.parent / "linked"
    real.mkdir(mode=0o700)
    (real / providers.LOCAL_FILE).symlink_to(elsewhere)
    assert "ordinary file" in client_for(real).get("/api/connections").json()["provider_file_problem"]
    for body in ("not json", json.dumps({"providers": [FICTIONAL_SYSTEM] * 11}), json.dumps({"providers": [], "extra": 1}),
                 json.dumps({"providers": [FICTIONAL_SYSTEM, FICTIONAL_SYSTEM]})):
        broken = data_dir.parent / f"broken-{abs(hash(body))}"
        broken.mkdir(mode=0o700)
        (broken / providers.LOCAL_FILE).write_text(body)
        (broken / providers.LOCAL_FILE).chmod(0o600)
        listed = client_for(broken).get("/api/connections").json()
        assert [p["key"] for p in listed["providers"]] == ["epic-sandbox"] and listed["provider_file_problem"]


@pytest.mark.parametrize("addresses, refused", [
    (["127.0.0.1"], True), (["10.1.2.3"], True), (["192.168.1.20"], True), (["100.64.0.1"], True), (["169.254.169.254"], True),
    (["::1"], True), (["fd00::1"], True), (["93.184.215.14", "10.0.0.1"], True), (["93.184.215.14"], False),
])
def test_a_provider_name_that_leads_to_this_machine_or_its_network_is_refused(monkeypatch, addresses, refused):
    from this_is_you.connectors import client as client_module
    monkeypatch.setattr(client_module.socket, "getaddrinfo", lambda *a, **k: [(None, None, None, "", (a_, 443)) for a_ in addresses])
    if refused:
        with pytest.raises(RefusedAddress):
            client_module.public_addresses("fhir.example.com")
    else:
        assert client_module.public_addresses("fhir.example.com") == addresses


class _Network:
    """Stands in for DNS and TCP: answers each lookup from a list, records every connection, and connects nowhere."""

    def __init__(self, monkeypatch, *answers):
        import socket
        self.answers, self.lookups, self.connected, self.tls = list(answers), [], [], []
        # A real TCP socket on this machine stands in for the provider, so no packet leaves it.
        self._listener = socket.create_server(("127.0.0.1", 0))
        monkeypatch.setattr(socket, "getaddrinfo", self.lookup)
        monkeypatch.setattr(socket, "create_connection", self.connect)
        monkeypatch.setattr(httpcore._backends.sync.SyncStream, "start_tls", self.start_tls)

    def lookup(self, host, port, *a, **k):
        self.lookups.append(host)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        return [(None, None, None, "", (answer, port))]

    def connect(self, address, *a, **k):
        self.connected.append(address[0])
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(self._listener.getsockname())  # By address: the patched name lookup is never used here.
        return sock

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.tls.append((server_hostname, ssl_context.check_hostname, ssl_context.verify_mode))
        raise httpcore.ConnectError("stopped here: no network in tests")


def test_a_provider_name_whose_answer_changes_never_reaches_a_private_address(monkeypatch):
    """DNS rebinding: public for the check, then private. Each connection uses the one lookup it checked."""
    net = _Network(monkeypatch, "93.184.215.14", "127.0.0.1")
    client = ProviderClient(SANDBOX, sleep=lambda _: None)
    with pytest.raises(RefusedAddress):
        client.get_public(SANDBOX.fhir_base + "/metadata")  # The retry looks the name up again, gets 127.0.0.1, and stops.
    assert net.connected == ["93.184.215.14"]
    assert "127.0.0.1" not in net.connected


def test_the_connection_goes_to_the_checked_address_and_the_certificate_must_match_the_name(monkeypatch):
    net = _Network(monkeypatch, "93.184.215.14")
    client = ProviderClient(SANDBOX, sleep=lambda _: None)
    with pytest.raises(service.ProviderError):
        client.get_public(SANDBOX.fhir_base + "/metadata")
    assert set(net.connected) == {"93.184.215.14"} and len(net.lookups) == len(net.connected)  # One lookup per connection.
    import ssl
    assert set(net.tls) == {(SANDBOX.host, True, ssl.CERT_REQUIRED)}


def test_a_private_answer_is_refused_before_any_connection(monkeypatch):
    net = _Network(monkeypatch, "10.0.0.5")
    with pytest.raises(RefusedAddress):
        ProviderClient(SANDBOX, sleep=lambda _: None).post_form(SANDBOX.fhir_base.split("/api")[0] + "/oauth2/token", {"a": "b"})
    assert net.connected == []


def test_the_printed_key_set_verifies_the_signed_assertion(data_dir):
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers

    keys = ConnectorKeys(sandbox_archive(data_dir))
    [jwk] = keys.public_jwks()["keys"]
    assert set(jwk) == {"kty", "n", "e", "kid", "alg", "use"} and (jwk["kty"], jwk["alg"], jwk["use"]) == ("RSA", "RS384", "sig")
    public = RSAPublicNumbers(int.from_bytes(_unpad(jwk["e"]), "big"), int.from_bytes(_unpad(jwk["n"]), "big")).public_key()
    assert public.key_size >= 2048
    token = keys.sign_jwt({"iss": CLIENT_ID})
    head, body, signature = token.split(".")
    assert json.loads(_unpad(head)) == {"alg": "RS384", "typ": "JWT", "kid": jwk["kid"]}
    public.verify(_unpad(signature), f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA384())
    assert "PRIVATE" not in json.dumps(keys.public_jwks())


def test_tokens_are_encrypted_and_keys_are_private(setup, data_dir):
    app_client, fake = setup
    sign_in(app_client, fake)
    import sqlite3

    stored = sqlite3.connect(data_dir / "archive.sqlite3").execute("select token_ciphertext from provider_connections").fetchone()[0]
    assert "access-current" not in stored and "refresh-fictional" not in stored
    for name in (SIGNING_KEY, TOKEN_KEY):
        assert (data_dir / name).stat().st_mode & 0o777 == 0o600


# --- Identity ---


def test_nothing_imports_before_the_person_confirms(setup):
    app_client, fake = setup
    set_identity(app_client)
    sign_in(app_client, fake)
    held = connection(app_client)
    assert held["status"] == "awaiting_confirmation" and held["identity_status"] == "possible_match"
    refused = app_client.post("/api/connections/epic-sandbox/sync", headers=CLIENT_HEADERS)
    assert refused.status_code == 409 and refused.json()["code"] == "awaiting_confirmation"
    assert fhir_results(app_client) == []


def test_a_mismatch_is_shown_and_still_waits(setup):
    app_client, fake = setup
    set_identity(app_client, name="Jordan Otherperson", born="1990-01-01")
    sign_in(app_client, fake)
    held = connection(app_client)
    assert held["status"] == "awaiting_confirmation" and held["identity_status"] == "possible_mismatch"


def test_confirming_must_name_the_patient_shown(setup):
    app_client, fake = setup
    set_identity(app_client)
    sign_in(app_client, fake)
    wrong = app_client.post("/api/connections/epic-sandbox/confirm-identity", json={"patient_fhir_id": "someone-else"}, headers=CLIENT_HEADERS)
    assert wrong.status_code == 409


def test_reconnecting_as_a_different_patient_holds_imports(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.token_patient = "eAnotherFictional02"
    fake.patient = {**fake.patient, "id": "eAnotherFictional02"}
    sign_in(app_client, fake, code="code-2")
    held = connection(app_client)
    assert held["status"] == "awaiting_confirmation" and "different patient" in held["identity_reason"]


def test_patient_details_changing_at_the_provider_hold_the_sync(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.patient = {**fake.patient, "birthDate": "1970-01-01"}
    run = sync(app_client)
    assert run["status"] == "held" and connection(app_client)["status"] == "awaiting_confirmation"
    assert fhir_results(app_client) == []


def test_records_naming_another_patient_are_never_kept(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.labs.append({**lab("lab-9", 1.0), "subject": {"reference": "Patient/someone-else"}})
    run = sync(app_client)
    assert run["counts"]["records_for_another_patient"] == 1 and len(fhir_results(app_client)) == 3


# --- Synchronizing ---


def test_sync_pages_through_results_and_proposes_them_for_review(setup):
    app_client, fake = setup
    connect(app_client, fake)
    run = sync(app_client)
    assert run["status"] == "completed", run
    assert run["counts"]["Observation_received"] == 3 and run["counts"]["results_proposed"] == 3
    results = fhir_results(app_client)
    assert {r["verification_status"] for r in results} == {"proposed"}
    hemoglobin = next(r for r in results if r["reported_name"] == "Hemoglobin")
    assert hemoglobin["collected_on"] == "2026-03-04" and hemoglobin["reported_on"] == "2026-03-05"
    assert hemoglobin["documented_on"] is None and hemoglobin["imported_at"][:10] != "2026-03-04"
    assert hemoglobin["value_text"] == "14.2" and hemoglobin["reference_text"] == "12-16"
    assert sum(1 for c in fake.calls if "/Observation?" in c) == 2


def test_syncing_again_adds_nothing_unchanged(setup):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    run = sync(app_client)
    assert run["counts"]["Observation_unchanged"] == 3 and "results_proposed" not in run["counts"]
    assert len(fhir_results(app_client)) == 3


def test_a_corrected_result_adds_a_version_and_never_changes_a_verified_one(setup):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    first = next(r for r in fhir_results(app_client) if r["reported_name"] == "Hemoglobin")
    assert app_client.post(f"/api/observations/{first['id']}/verify", headers=CLIENT_HEADERS).status_code == 200
    fake.labs[0] = lab("lab-1", 13.8, status="corrected", version="2")
    sync(app_client)
    hemoglobins = [r for r in fhir_results(app_client) if r["reported_name"] == "Hemoglobin"]
    kept = next(r for r in hemoglobins if r["id"] == first["id"])
    new = next(r for r in hemoglobins if r["id"] != first["id"])
    assert kept["verification_status"] == "verified" and kept["value_text"] == "14.2"
    assert new["verification_status"] == "proposed" and new["value_text"] == "13.8" and any("changed at the provider" in i for i in new["issues"])
    assert connection(app_client)["record_versions"]["Observation"] == 4


def test_a_missing_date_is_flagged_never_filled_in(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.labs = [lab("lab-5", 4.0, unit="mmol/L", name="Potassium", day=None)]
    sync(app_client)
    result = fhir_results(app_client)[0]
    assert result["collected_on"] is None and any("no collection date" in i for i in result["issues"])


def test_results_that_are_not_final_are_kept_but_not_proposed(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.labs = [lab("lab-6", 1.0, status="entered-in-error"), lab("lab-7", 1.0, status="cancelled")]
    run = sync(app_client)
    assert run["counts"]["results_not_final"] == 2 and fhir_results(app_client) == []


def test_a_result_matching_a_pdf_result_is_marked_a_possible_duplicate(setup):
    app_client, fake = setup
    connect(app_client, fake)
    entered = app_client.post("/api/observations", json={"fields": {"reported_name": "Hemoglobin", "value_text": "14.20", "unit": "g/dL", "collected_on": "2026-03-04"}},
                              headers=CLIENT_HEADERS)
    assert entered.status_code == 201, entered.text
    sync(app_client)
    hemoglobin = next(r for r in fhir_results(app_client) if r["reported_name"] == "Hemoglobin")
    assert entered.json()["id"] in hemoglobin["possible_duplicates"]
    assert app_client.get(f"/api/observations/{entered.json()['id']}").json()["value_text"] == "14.20"


def test_a_provider_result_has_the_same_review_and_history_as_a_report_result(setup):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    first = next(r for r in fhir_results(app_client) if r["reported_name"] == "Hemoglobin")
    assert first["verification_status"] == "proposed" and first["revisions"][0]["action"] == "imported"
    source = first["source_resource"]
    assert (source["provider"], source["resource_type"], source["fhir_id"], source["version_number"], source["versions_kept"]) == ("epic-sandbox", "Observation", "lab-1", 1, 1)
    oid = first["id"]
    assert app_client.post(f"/api/observations/{oid}/correct", json={"fields": {"value_text": "14.3"}}, headers=CLIENT_HEADERS).status_code == 200
    for action in ("verify", "reopen", "reject"):
        assert app_client.post(f"/api/observations/{oid}/{action}", headers=CLIENT_HEADERS).status_code == 200
    now = app_client.get(f"/api/observations/{oid}").json()
    assert [r["action"] for r in now["revisions"]] == ["imported", "corrected", "verified", "reopened", "rejected"]
    assert now["original"]["value_text"] == "14.2" and now["value_text"] == "14.3" and now["edited"] is True
    # A new version at the provider is a new proposal beside the old one, which keeps its own version and decision.
    fake.labs[0] = lab("lab-1", 13.8, status="corrected", version="2")
    sync(app_client)
    hemoglobins = {r["id"]: r for r in fhir_results(app_client) if r["reported_name"] == "Hemoglobin"}
    assert hemoglobins[oid]["verification_status"] == "rejected" and hemoglobins[oid]["source_resource"]["version_number"] == 1
    newer = next(r for i, r in hemoglobins.items() if i != oid)
    assert newer["verification_status"] == "proposed" and (newer["source_resource"]["version_number"], newer["source_resource"]["versions_kept"]) == (2, 2)


def test_one_result_from_a_provider_record_and_its_pdf_is_flagged_never_merged_or_decided(setup):
    from . import pdfs
    app_client, fake = setup
    connect(app_client, fake)
    report = ["Fictional Lab Report", "Specimen Collected: 03/04/2026 08:00", "Component Your Value Standard Range",
              "Hemoglobin 14.20 g/dL 11.1 - 15.9 g/dL"]
    fake.binaries["lab-pdf"] = pdfs.text_pdf(report)
    fake.documents = [{"resourceType": "DocumentReference", "id": "doc-9", "subject": {"reference": f"Patient/{PATIENT}"}, "date": "2026-03-05T00:00:00Z",
                       "content": [{"attachment": {"contentType": "application/pdf", "url": "Binary/lab-pdf"}}]}]
    sync(app_client)
    app_client.app.state.extraction.wait_idle()
    every = app_client.get("/api/observations").json()["observations"]
    provider = next(o for o in every if o["origin"] == "fhir" and o["reported_name"] == "Hemoglobin")
    printed = next(o for o in every if o["origin"] == "extracted" and o["reported_name"] == "Hemoglobin")
    assert printed["value_text"] == "14.20" and provider["value_text"] == "14.2"
    assert provider["id"] in printed["possible_duplicates"] and printed["id"] in provider["possible_duplicates"]
    assert provider["verification_status"] == printed["verification_status"] == "proposed"
    # Deciding one decides nothing about the other, and neither is changed or removed.
    assert app_client.post(f"/api/observations/{provider['id']}/verify", headers=CLIENT_HEADERS).status_code == 200
    again = {o["id"]: o for o in app_client.get("/api/observations").json()["observations"]}
    assert again[printed["id"]]["verification_status"] == "proposed" and again[printed["id"]]["value_text"] == "14.20"
    assert app_client.post(f"/api/observations/{printed['id']}/verify", headers=CLIENT_HEADERS).status_code == 200
    both = [o for o in app_client.get("/api/observations").json()["observations"] if o["reported_name"] == "Hemoglobin" and o["verification_status"] == "verified"]
    assert len(both) == 2  # Both kept as sources. The charts draw them as one point.
    sync(app_client)
    assert len([o for o in app_client.get("/api/observations").json()["observations"] if o["reported_name"] == "Hemoglobin"]) == 2


def test_pdf_attachments_go_through_the_document_pipeline(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.binaries["note-1"] = make_pdf("Fictional clinical note")
    fake.documents = [{"resourceType": "DocumentReference", "id": "doc-1", "subject": {"reference": f"Patient/{PATIENT}"}, "date": "2026-02-01T00:00:00Z",
                       "content": [{"attachment": {"contentType": "application/pdf", "url": "Binary/note-1"}}]},
                      {"resourceType": "DocumentReference", "id": "doc-2", "subject": {"reference": f"Patient/{PATIENT}"},
                       "content": [{"attachment": {"contentType": "text/html", "url": "Binary/html-1"}}]}]
    run = sync(app_client)
    assert run["counts"]["documents_stored"] == 1 and run["counts"]["notes_kept_as_records_only"] == 1
    documents = app_client.get("/api/documents").json()["documents"]
    assert [d["original_filename"] for d in documents] == ["Epic sandbox clinical document 2026-02-01.pdf"]
    again = sync(app_client)
    assert again["counts"]["DocumentReference_unchanged"] == 2 and len(app_client.get("/api/documents").json()["documents"]) == 1


def test_an_unavailable_optional_resource_makes_a_partial_run(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.diagnostic_status = 403
    run = sync(app_client)
    assert run["status"] == "partial" and any("DiagnosticReport" in p for p in run["problems"])
    assert len(fhir_results(app_client)) == 3


# --- Tokens, failures and recovery ---


def test_an_expired_token_is_renewed_with_the_refresh_token(setup):
    app_client, fake = setup
    fake.expires_in = 1
    connect(app_client, fake)
    run = sync(app_client)
    assert run["status"] == "completed"
    assert any(c.startswith(f"POST {OAUTH}/token") for c in fake.calls[3:])


def test_an_ended_permission_asks_for_sign_in_and_keeps_what_was_imported(setup):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    fake.expires_in = 1
    sign_in(app_client, fake, code="code-3")
    fake.refresh_ok = False
    run = sync(app_client)
    assert run["status"] == "failed" and connection(app_client)["status"] == "needs_sign_in"
    assert len(fhir_results(app_client)) == 3
    assert app_client.post("/api/connections/epic-sandbox/sync", headers=CLIENT_HEADERS).json()["code"] == "needs_sign_in"


def test_busy_providers_are_retried_a_bounded_number_of_times(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.fail_next = [503, 429]
    assert sync(app_client)["status"] == "completed"
    fake.fail_next = [503, 503, 503]
    assert sync(app_client)["status"] == "failed"


def test_an_unexpected_failure_keeps_each_saved_page(setup):
    app_client, fake = setup
    connect(app_client, fake)
    real = fake.page
    fake.page = lambda kind, items, page: (_ for _ in ()).throw(RuntimeError("fictional fault")) if page == 1 else real(kind, items, page)
    run = sync(app_client)
    assert run["status"] == "failed" and run["problems"] == ["Stopped by an unexpected error. Everything saved before it is kept."]
    assert len(fhir_results(app_client)) == 2  # The first page was saved.
    fake.page = real
    assert sync(app_client)["status"] == "completed" and len(fhir_results(app_client)) == 3


def test_a_sync_cut_off_by_the_service_stopping_is_marked_interrupted(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    import sqlite3

    with sqlite3.connect(data_dir / "archive.sqlite3") as db:  # As if the process died before recording the end.
        db.execute("update sync_runs set status = 'running', finished_at = null")
    restarted = client_for(data_dir, epic_nonproduction_client_id=CLIENT_ID)  # The same sandbox archive, started again.
    run = connection(restarted)["runs"][0]
    assert run["status"] == "interrupted" and "Everything saved before that is kept" in run["problems"][-1]
    assert len(fhir_results(restarted)) == 3


def test_a_restored_archive_without_the_token_key_asks_for_sign_in(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    (data_dir / TOKEN_KEY).unlink()
    run = sync(app_client)
    assert run["status"] == "failed" and connection(app_client)["status"] == "needs_sign_in"


# --- Addresses and leaks ---


def test_only_the_providers_own_addresses_are_allowed():
    sandbox = SANDBOX
    assert check_address(sandbox, BASE + "/Observation?patient=x", under_base=True)
    for bad in ["http://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Patient/x", "https://evil.example/interconnect-fhir-oauth/api/FHIR/R4/x",
                "https://fhir.epic.com.evil.example/x", "https://user@fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/x",
                "https://fhir.epic.com:8443/interconnect-fhir-oauth/api/FHIR/R4/x", "https://fhir.epic.com/other/x",
                "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/../../oauth2/token", "https://169.254.169.254/latest"]:
        with pytest.raises(RefusedAddress):
            check_address(sandbox, bad, under_base=True)


def test_a_next_link_elsewhere_is_refused_and_no_token_is_sent(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.next_override = "https://attacker.example/steal"
    run = sync(app_client)
    assert run["status"] == "failed" and not any("attacker" in c for c in fake.calls)


def test_redirects_are_never_followed():
    sent = []

    def handler(request):
        sent.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://attacker.example/"})

    client = ProviderClient(SANDBOX, httpx.MockTransport(handler))
    with pytest.raises(RefusedAddress):
        client.get_record(BASE + "/Patient/x", "token")
    assert sent == [BASE + "/Patient/x"]


def test_an_attachment_outside_the_provider_is_not_fetched(setup):
    app_client, fake = setup
    connect(app_client, fake)
    fake.documents = [{"resourceType": "DocumentReference", "id": "doc-3", "subject": {"reference": f"Patient/{PATIENT}"},
                       "content": [{"attachment": {"contentType": "application/pdf", "url": "https://attacker.example/file.pdf"}}]}]
    run = sync(app_client)
    assert run["counts"]["attachments_refused"] == 1 and not any("attacker" in c for c in fake.calls)


def test_logs_hold_no_tokens_or_record_contents(setup, caplog):
    app_client, fake = setup
    caplog.set_level(logging.DEBUG)
    connect(app_client, fake)
    sync(app_client)
    text = caplog.text
    for secret in ("access-current", "refresh-fictional", "Avery", "Fictional", "Hemoglobin", "14.2", "1987-09-12"):
        assert secret not in text


# --- Disconnecting ---


def test_disconnect_revokes_removes_tokens_and_keeps_records_until_asked(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    answer = app_client.post("/api/connections/epic-sandbox/disconnect", headers=CLIENT_HEADERS).json()
    assert answer["revoked"] is True and set(fake.revoked) == {"refresh_token", "access_token"}
    import sqlite3

    assert sqlite3.connect(data_dir / "archive.sqlite3").execute("select token_ciphertext from provider_connections").fetchone()[0] is None
    assert connection(app_client)["status"] == "disconnected" and len(fhir_results(app_client)) == 3
    assert app_client.post("/api/connections/epic-sandbox/sync", headers=CLIENT_HEADERS).status_code == 409


def test_imported_records_are_deleted_only_when_asked_after_disconnecting(setup):
    app_client, fake = setup
    connect(app_client, fake)
    sync(app_client)
    early = app_client.post("/api/connections/epic-sandbox/delete-imported", headers=CLIENT_HEADERS)
    assert early.status_code == 409 and len(fhir_results(app_client)) == 3
    app_client.post("/api/connections/epic-sandbox/disconnect", headers=CLIENT_HEADERS)
    deleted = app_client.post("/api/connections/epic-sandbox/delete-imported", headers=CLIENT_HEADERS).json()["deleted"]
    assert deleted == {"records": 4, "results": 3} and fhir_results(app_client) == []


def test_reconnecting_the_same_patient_needs_no_new_confirmation(setup):
    app_client, fake = setup
    connect(app_client, fake)
    app_client.post("/api/connections/epic-sandbox/disconnect", headers=CLIENT_HEADERS)
    sign_in(app_client, fake, code="code-4")
    assert connection(app_client)["status"] == "connected"
    assert sync(app_client)["status"] == "completed"


def test_backups_carry_no_usable_credential(setup, data_dir, tmp_path):
    app_client, fake = setup
    connect(app_client, fake)
    from this_is_you.backup import create_backup

    create_backup(data_dir / "archive.sqlite3", data_dir / "originals", tmp_path / "backup")
    names = {p.name for p in (tmp_path / "backup").rglob("*")}
    assert SIGNING_KEY not in names and TOKEN_KEY not in names


# --- Rolling refresh tokens ---


def stored(data_dir) -> tuple[str | None, int, str]:
    import sqlite3

    with sqlite3.connect(data_dir / "archive.sqlite3") as db:
        return db.execute("select token_ciphertext, token_generation, status from provider_connections").fetchone()


def stored_tokens(data_dir) -> dict:
    import sqlite3

    with sqlite3.connect(data_dir / "archive.sqlite3") as db:
        sealed, row_id = db.execute("select token_ciphertext, id from provider_connections").fetchone()
    return ConnectorKeys(data_dir).open(sealed, row_id)


def database_bytes(data_dir) -> bytes:
    return b"".join(p.read_bytes() for p in data_dir.glob("archive.sqlite3*"))


def test_each_new_refresh_token_replaces_the_last_and_is_used_next(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1  # Every request renews first, so one sync rolls the token several times.
    connect(app_client, fake)
    assert stored_tokens(data_dir)["refresh_token"] == "refresh-fictional-1"
    sync(app_client)
    assert fake.issued > 3
    # Each refresh sent the token the one before it issued, and every one of them was accepted.
    assert fake.refresh_used == [f"refresh-fictional-{n}" for n in range(1, fake.issued)]
    assert connection(app_client)["runs"][0]["status"] == "completed"
    assert stored_tokens(data_dir)["refresh_token"] == f"refresh-fictional-{fake.issued}"
    everything = database_bytes(data_dir)
    for n in range(1, fake.issued + 1):
        assert f"refresh-fictional-{n}".encode() not in everything  # Encrypted, and the replaced ones are gone.


def test_the_newest_refresh_token_survives_a_restart(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1
    connect(app_client, fake)
    sync(app_client)
    newest = fake.refresh_current
    restarted = client_for(data_dir, epic_nonproduction_client_id=CLIENT_ID)
    restarted.app.state.connectors.transport = httpx.MockTransport(fake.handle)
    restarted.app.state.connectors.sleep = lambda _seconds: None
    used_before = len(fake.refresh_used)
    assert sync(restarted)["status"] == "completed"
    assert fake.refresh_used[used_before] == newest  # The old ones were invalidated, so only the newest could work.


def test_a_refresh_with_no_new_refresh_token_keeps_the_one_stored(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1
    fake.rotate = False
    connect(app_client, fake)
    sync(app_client)
    assert set(fake.refresh_used) == {"refresh-fictional-1"} and len(fake.refresh_used) > 1
    assert stored_tokens(data_dir)["refresh_token"] == "refresh-fictional-1"
    assert sync(app_client)["status"] == "completed"


def test_a_failed_token_write_leaves_the_stored_tokens_whole(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1  # Before signing in, so the very next request renews.
    connect(app_client, fake)
    before = stored(data_dir)
    import sqlite3

    with sqlite3.connect(data_dir / "archive.sqlite3") as db:  # As if the disk failed at the moment of writing.
        db.execute("create trigger fictional_failure before update of token_ciphertext on provider_connections begin select raise(abort, 'fictional'); end")
    run = sync(app_client)
    assert run["status"] == "failed" and stored(data_dir) == before
    assert stored_tokens(data_dir)["refresh_token"] == "refresh-fictional-1"  # Still whole, and still opens.
    with sqlite3.connect(data_dir / "archive.sqlite3") as db:
        db.execute("drop trigger fictional_failure")
    # The provider already replaced that token, so the honest result is a request to sign in again, not a broken record.
    assert sync(app_client)["status"] == "failed" and connection(app_client)["status"] == "needs_sign_in"


def test_a_failed_seal_writes_nothing(setup, data_dir, monkeypatch):
    app_client, fake = setup
    fake.expires_in = 1  # Before signing in, so the very next request renews.
    connect(app_client, fake)
    before = stored(data_dir)
    monkeypatch.setattr(ConnectorKeys, "seal", lambda *_args: (_ for _ in ()).throw(OSError("fictional")))
    assert sync(app_client)["status"] == "failed" and stored(data_dir) == before


# --- Disconnect is authoritative, whatever is running ---


import threading  # noqa: E402


def in_thread(work):
    done: dict = {}

    def run():
        try:
            done["value"] = work()
        except Exception as problem:  # noqa: BLE001
            done["error"] = problem

    thread = threading.Thread(target=run)
    thread.start()
    return thread, done


def pause_at(event_name: str):
    reached, release = threading.Event(), threading.Event()

    def hook(*_args):
        reached.set()
        assert release.wait(10), f"{event_name} was never released"

    return hook, reached, release


def test_disconnect_waits_for_a_refresh_under_way_and_revokes_its_result(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1  # Before signing in, so the very next request renews.
    connect(app_client, fake)
    c = app_client.app.state.connectors
    hook, reached, release = pause_at("refresh")
    fake.on_refresh = hook
    syncing, synced = in_thread(lambda: service.synchronize(c, "epic-sandbox"))
    assert reached.wait(10)
    disconnecting, disconnected = in_thread(lambda: service.disconnect(c, "epic-sandbox"))
    disconnecting.join(0.3)
    assert disconnecting.is_alive()  # Waiting for the refresh, so it cannot miss the token it is about to bring.
    fake.on_refresh = None
    release.set()
    syncing.join(10), disconnecting.join(10)
    ciphertext, _generation, status = stored(data_dir)
    assert status == "disconnected" and ciphertext is None
    assert fake.refresh_current not in database_bytes(data_dir).decode("latin-1")
    assert fake.refresh_current in fake.revoked_values  # The token the refresh brought is the one revoked, not the one it replaced.
    assert connection(app_client)["runs"][0]["status"] == "stopped" and fhir_results(app_client) == []


def test_a_sync_between_pages_imports_nothing_more_after_disconnect(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    c = app_client.app.state.connectors
    hook, reached, release = pause_at("page")
    fake.on_page = lambda kind, page: hook() if page == 1 else None
    syncing, _ = in_thread(lambda: service.synchronize(c, "epic-sandbox"))
    assert reached.wait(10)
    service.disconnect(c, "epic-sandbox")  # Not blocked: no write is under way between pages.
    release.set()
    syncing.join(10)
    assert len(fhir_results(app_client)) == 2  # Only the first page, kept from before the disconnect.
    run = connection(app_client)["runs"][0]
    assert run["status"] == "stopped" and "Nothing more was imported" in run["problems"][-1]
    ciphertext, _generation, status = stored(data_dir)
    assert (ciphertext, status) == (None, "disconnected")


def test_an_ending_permission_after_disconnect_leaves_it_disconnected(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    c = app_client.app.state.connectors
    hook, reached, release = pause_at("page")

    def page(kind, number):
        if number == 1:
            hook()
            return httpx.Response(401)  # The provider has noticed too: the renewal below must not reopen anything.
        return None

    fake.on_page = page
    syncing, _ = in_thread(lambda: service.synchronize(c, "epic-sandbox"))
    assert reached.wait(10)
    service.disconnect(c, "epic-sandbox")
    release.set()
    syncing.join(10)
    ciphertext, _generation, status = stored(data_dir)
    assert (ciphertext, status) == (None, "disconnected")
    assert not any(c.startswith(f"POST {OAUTH}/token") for c in fake.calls[-3:])


def test_a_refused_refresh_racing_a_disconnect_still_ends_disconnected(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1  # Before signing in, so the very next request renews.
    connect(app_client, fake)
    c = app_client.app.state.connectors
    fake.refresh_ok = False
    hook, reached, release = pause_at("refresh")
    fake.on_refresh = hook
    syncing, _ = in_thread(lambda: service.synchronize(c, "epic-sandbox"))
    assert reached.wait(10)
    disconnecting, _ = in_thread(lambda: service.disconnect(c, "epic-sandbox"))
    release.set()
    syncing.join(10), disconnecting.join(10)
    ciphertext, _generation, status = stored(data_dir)
    assert (ciphertext, status) == (None, "disconnected")


def test_signing_in_again_during_a_sync_makes_the_old_sync_stop(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    c = app_client.app.state.connectors
    hook, reached, release = pause_at("page")
    fake.on_page = lambda kind, page: hook() if page == 1 else None
    syncing, _ = in_thread(lambda: service.synchronize(c, "epic-sandbox"))
    assert reached.wait(10)
    fake.on_page = None
    sign_in(app_client, fake, code="code-again")
    newest = stored_tokens(data_dir)
    release.set()
    syncing.join(10)
    assert connection(app_client)["runs"][0]["status"] == "stopped"
    assert stored_tokens(data_dir) == newest and stored(data_dir)[2] == "connected"  # The new sign-in's tokens are untouched.


def test_an_expired_authorization_still_asks_for_sign_in(setup, data_dir):
    app_client, fake = setup
    fake.expires_in = 1  # Before signing in, so the very next request renews.
    connect(app_client, fake)
    fake.refresh_ok = False
    run = sync(app_client)
    assert run["status"] == "failed" and stored(data_dir)[:1] == (None,) and stored(data_dir)[2] == "needs_sign_in"


def test_a_stale_request_to_sign_in_again_cannot_undo_a_disconnect(setup, data_dir):
    app_client, fake = setup
    connect(app_client, fake)
    c = app_client.app.state.connectors
    _ciphertext, generation, _status = stored(data_dir)
    row_id = next(iter(c.sessions().execute(__import__("sqlalchemy").text("select id from provider_connections"))))[0]
    service.disconnect(c, "epic-sandbox")
    service._needs_sign_in(c, "epic-sandbox", row_id, generation)  # What a sync that started before the disconnect would do.
    assert stored(data_dir)[2] == "disconnected"

