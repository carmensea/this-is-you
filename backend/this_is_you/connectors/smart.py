"""SMART on FHIR standalone patient sign-in: discovery, PKCE, a signed client assertion, and token refresh."""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode
from uuid import uuid4

from .client import ProviderClient, ProviderError, check_address
from .keys import ConnectorKeys
from .providers import Provider

# Read-only. Epic grants only the APIs registered on the app, whatever is asked here.
SCOPES = ("openid", "fhirUser", "launch/patient", "offline_access", "patient/Patient.read", "patient/Observation.read",
          "patient/DiagnosticReport.read", "patient/DocumentReference.read", "patient/Binary.read")


@dataclass(frozen=True)
class Endpoints:
    authorize: str
    token: str
    revoke: str | None


@dataclass(frozen=True)
class Pending:
    """One sign-in in progress, held in memory only, for minutes."""

    provider_key: str
    verifier: str
    redirect_uri: str
    created: float


def discover(client: ProviderClient) -> Endpoints:
    provider = client.provider
    answer = client.get_public(provider.fhir_base + "/.well-known/smart-configuration")
    if answer.status != 200:
        raise ProviderError("The provider's sign-in settings could not be read.", answer.status)
    config = answer.json()
    methods = config.get("code_challenge_methods_supported") or []
    if "S256" not in methods:
        raise ProviderError("The provider does not offer the required sign-in protection (PKCE).")
    revoke = config.get("revocation_endpoint")
    # Only addresses on the provider's own host are used, whatever the document says.
    return Endpoints(
        authorize=check_address(provider, str(config.get("authorization_endpoint")), under_base=False),
        token=check_address(provider, str(config.get("token_endpoint")), under_base=False),
        revoke=check_address(provider, str(revoke), under_base=False) if revoke else None,
    )


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize_url(provider: Provider, endpoints: Endpoints, client_id: str, redirect_uri: str, state: str, challenge: str) -> str:
    query = {
        "response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "scope": " ".join(SCOPES),
        "state": state, "aud": provider.fhir_base, "code_challenge": challenge, "code_challenge_method": "S256",
    }
    return endpoints.authorize + ("&" if "?" in endpoints.authorize else "?") + urlencode(query)


def client_assertion(keys: ConnectorKeys, client_id: str, token_url: str) -> str:
    now = int(time.time())
    # Epic: no more than five minutes from iat to exp, the client ID in iss and sub, and a jti of at most 151 characters.
    return keys.sign_jwt({"iss": client_id, "sub": client_id, "aud": token_url, "jti": uuid4().hex, "iat": now, "nbf": now, "exp": now + 240})


def _client_auth(keys: ConnectorKeys, client_id: str, token_url: str) -> dict:
    return {"client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": client_assertion(keys, client_id, token_url)}


def _tokens(answer, refresh_fallback: str | None = None) -> dict:
    if answer.status != 200:
        code = None
        try:
            code = answer.json().get("error")
        except ProviderError:
            pass
        raise ProviderError("The provider refused the sign-in." if code != "invalid_grant" else "The provider's permission has ended. Sign in again.",
                            answer.status, code)
    data = answer.json()
    if data.get("token_type", "").lower() != "bearer" or not data.get("access_token"):
        raise ProviderError("The provider sent no usable access.")
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or refresh_fallback,
        "expires_at": time.time() + float(data.get("expires_in") or 300),
        "scope": data.get("scope", ""),
        "patient": data.get("patient"),
    }


def exchange_code(client: ProviderClient, keys: ConnectorKeys, endpoints: Endpoints, client_id: str, code: str, pending: Pending) -> dict:
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": pending.redirect_uri, "code_verifier": pending.verifier,
            **_client_auth(keys, client_id, endpoints.token)}
    return _tokens(client.post_form(endpoints.token, form))


def refresh(client: ProviderClient, keys: ConnectorKeys, endpoints: Endpoints, client_id: str, tokens: dict) -> dict:
    if not tokens.get("refresh_token"):
        raise ProviderError("The provider's permission has ended. Sign in again.", code="invalid_grant")
    form = {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], **_client_auth(keys, client_id, endpoints.token)}
    renewed = _tokens(client.post_form(endpoints.token, form), refresh_fallback=tokens["refresh_token"])
    renewed["patient"] = renewed.get("patient") or tokens.get("patient")
    return renewed


def revoke(client: ProviderClient, keys: ConnectorKeys, endpoints: Endpoints, client_id: str, tokens: dict) -> bool:
    """Asks the provider to end the permission, where it offers a way. True only if it said yes."""
    if not endpoints.revoke:
        return False
    done = True
    for kind in ("refresh_token", "access_token"):
        if tokens.get(kind):
            form = {"token": tokens[kind], "token_type_hint": kind, **_client_auth(keys, client_id, endpoints.revoke)}
            try:
                done = client.post_form(endpoints.revoke, form).status == 200 and done
            except ProviderError:
                done = False
    return done
