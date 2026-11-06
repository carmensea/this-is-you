"""Every request to a provider goes through here, and only to that provider's own addresses.

- HTTPS only, to the provider's own host, on the default port, with no user name in the address.
- A token is only ever sent to an address under the provider's FHIR base it was issued for.
- Redirects are never followed, so a server cannot send the request, or its token, somewhere else.
- Answers are size-limited, and waits and retries are bounded.
- Nothing from an answer is logged: only the record type, status and size.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .providers import Provider

log = logging.getLogger("this_is_you.connectors")
# httpx logs every address it requests, and these addresses name the patient. Its warnings still show.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

TIMEOUT = httpx.Timeout(20.0, connect=10.0)
JSON_LIMIT = 20 * 1024 * 1024
FILE_LIMIT = 60 * 1024 * 1024
RETRY_STATUSES = {429, 502, 503, 504}
ATTEMPTS = 3
LONGEST_WAIT = 10.0


class ProviderError(Exception):
    """A provider request failed. The message is safe to show and store: it never holds record contents."""

    def __init__(self, message: str, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status, self.code = status, code


class RefusedAddress(ProviderError):
    """An address outside what this provider is allowed to be asked. Possibly an attempt to redirect a request."""


@dataclass(frozen=True)
class Answer:
    status: int
    content_type: str
    body: bytes

    def json(self) -> dict:
        import json

        try:
            data = json.loads(self.body)
        except ValueError:
            raise ProviderError("The provider sent an answer that is not valid JSON.") from None
        if not isinstance(data, dict):
            raise ProviderError("The provider sent an unexpected answer.")
        return data


def check_address(provider: Provider, url: str, *, under_base: bool) -> str:
    """The address, if this provider may be asked it. Raises RefusedAddress otherwise."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise RefusedAddress("Refused an address that could not be read.") from None
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443) or (parts.hostname or "").lower() != provider.host:
        raise RefusedAddress("Refused an address outside this provider.")
    if under_base and not (url == provider.fhir_base or url.startswith(provider.fhir_base + "/") or url.startswith(provider.fhir_base + "?")):
        raise RefusedAddress("Refused an address outside this provider's records.")
    if any(segment in ("..", ".") for segment in parts.path.split("/")):
        raise RefusedAddress("Refused an address with a relative path.")
    return url


def refuse_private_host(host: str) -> None:
    """A provider's name must lead to the internet, never to this machine or its network, where a credential could be caught.
    shortcut: checked before each request, and the connection resolves the name again; a name that changes in between could
    still slip through. Pin the resolved address in the transport if providers ever come from anyone but the archive's owner."""
    try:
        found = {info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
    except OSError:
        raise ProviderError("The provider could not be reached.") from None
    if not found or not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in found):
        raise RefusedAddress("Refused a provider whose name leads to a private or local address.")


class ProviderClient:
    def __init__(self, provider: Provider, transport: httpx.BaseTransport | None = None, sleep=time.sleep) -> None:
        self.provider = provider
        self.sleep = sleep
        self._real_network = transport is None
        self._http = httpx.Client(transport=transport, timeout=TIMEOUT, follow_redirects=False, trust_env=False,
                                  headers={"User-Agent": "ThisIsYou-connector"})

    def close(self) -> None:
        self._http.close()

    def _send(self, method: str, url: str, *, limit: int, retry: bool, **kwargs) -> Answer:
        if self._real_network:
            refuse_private_host(urlsplit(url).hostname or "")
        for attempt in range(1, ATTEMPTS + 1):
            try:
                with self._http.stream(method, url, **kwargs) as response:
                    if response.is_redirect:
                        raise RefusedAddress("The provider answered with a redirect, which is never followed.", response.status_code)
                    declared = int(response.headers.get("content-length") or 0)
                    if declared > limit:
                        raise ProviderError("The provider's answer was larger than allowed.", response.status_code)
                    body = b""
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) > limit:
                            raise ProviderError("The provider's answer was larger than allowed.", response.status_code)
                    status, kind = response.status_code, response.headers.get("content-type", "")
                    wait = response.headers.get("retry-after")
            except httpx.TransportError:
                if retry and attempt < ATTEMPTS:
                    self.sleep(min(2.0 ** attempt, LONGEST_WAIT))
                    continue
                raise ProviderError("The provider could not be reached.") from None
            log.info("%s %s: %d, %d bytes", method, self.provider.key, status, len(body))
            if retry and status in RETRY_STATUSES and attempt < ATTEMPTS:
                try:
                    pause = float(wait) if wait is not None else 2.0 ** attempt
                except ValueError:
                    pause = 2.0 ** attempt
                self.sleep(max(0.0, min(pause, LONGEST_WAIT)))
                continue
            return Answer(status, kind, body)
        raise AssertionError("unreachable")

    def get_public(self, url: str) -> Answer:
        """Discovery documents: no token is sent."""
        return self._send("GET", check_address(self.provider, url, under_base=False), limit=JSON_LIMIT, retry=True, headers={"Accept": "application/json"})

    def post_form(self, url: str, form: dict) -> Answer:
        """Token and revocation requests. Never retried: an authorization code works once."""
        return self._send("POST", check_address(self.provider, url, under_base=False), limit=JSON_LIMIT, retry=False, data=form,
                          headers={"Accept": "application/json"})

    def get_record(self, url: str, token: str, accept: str = "application/fhir+json", limit: int = JSON_LIMIT) -> Answer:
        return self._send("GET", check_address(self.provider, url, under_base=True), limit=limit, retry=True,
                          headers={"Accept": accept, "Authorization": f"Bearer {token}"})
