"""Keeps the service reachable only from this computer and only from this app.

There is no login. These checks hold even if the server is started directly with a wider bind
address, and they stop other websites open in the same browser from reaching it.
"""
from __future__ import annotations

import ipaddress
import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

CLIENT_HEADER = b"x-this-is-you-client"
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

_SECURITY_HEADERS = {
    b"content-security-policy": b"default-src 'none'; frame-ancestors 'none'",
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"no-referrer",
    b"cross-origin-resource-policy": b"same-origin",
    b"cache-control": b"no-store",
}


def _is_loopback(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_loopback or (getattr(ip, "ipv4_mapped", None) is not None and ip.ipv4_mapped.is_loopback)


def _hostname(host_header: str) -> str:
    return host_header[: host_header.index("]") + 1] if host_header.startswith("[") else host_header.split(":", 1)[0]


def _refusal(scope: Scope, headers: dict[bytes, bytes]) -> str | None:
    client = scope.get("client")
    if client is None or not _is_loopback(client[0]):
        return "This service only accepts connections from this computer."
    # A Host check defeats DNS rebinding, where a website points its own name at 127.0.0.1.
    if _hostname(headers.get(b"host", b"").decode("latin-1")) not in ALLOWED_HOSTS:
        return "Unrecognized host."
    if headers.get(b"sec-fetch-site") == b"cross-site":
        return "Requests from other websites are not allowed."
    # A custom header cannot be sent cross-site without a CORS approval this service never gives.
    if scope["method"] not in SAFE_METHODS and CLIENT_HEADER not in headers:
        return "Requests must come from the This Is You app."
    return None


class LocalOnlyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {name.lower() for name, _ in message.get("headers", [])}
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(k, v) for k, v in _SECURITY_HEADERS.items() if k not in present]
            await send(message)

        reason = _refusal(scope, dict(scope["headers"]))
        if reason is None:
            await self.app(scope, receive, send_with_headers)
            return
        body = json.dumps({"code": "forbidden", "message": reason}).encode()
        await send_with_headers({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
