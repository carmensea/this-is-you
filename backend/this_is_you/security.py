"""Every request passes through here. Only this computer, only this app, and only when signed in.

Refusal is the default: a route is open without a session only if it is listed in PUBLIC, so a route added later is
protected without anyone remembering to protect it. docs/threat-model.md explains what each check is for.
"""
from __future__ import annotations

import ipaddress
import json

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import sessionmaker
from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import auth

CLIENT_HEADER = b"x-this-is-you-client"
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
PUBLIC = {("GET", "/api/status"), ("POST", "/api/auth/login")}

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
    host = headers.get(b"host", b"").decode("latin-1")
    if _hostname(host) not in ALLOWED_HOSTS:
        return "Unrecognized host."
    # Same-site is refused too: another app on this machine or a sibling name is still not this app.
    if headers.get(b"sec-fetch-site") in (b"cross-site", b"same-site"):
        return "Requests from other websites are not allowed."
    origin = headers.get(b"origin")
    if origin is not None and origin.decode("latin-1").split("://", 1)[-1] != host:
        return "Requests from other websites are not allowed."
    # A custom header cannot be sent cross-site without a CORS approval this service never gives.
    if scope["method"] not in SAFE_METHODS and CLIENT_HEADER not in headers:
        return "Requests must come from the This Is You app."
    return None


def _session_token(headers: dict[bytes, bytes]) -> str | None:
    # Cookies ignore ports, so other local apps' cookies arrive here too. This parser tolerates whatever they hold.
    return cookie_parser(headers.get(b"cookie", b"").decode("latin-1")).get(auth.COOKIE)


class LocalOnlyMiddleware:
    def __init__(self, app: ASGIApp, sessions: sessionmaker) -> None:
        self.app = app
        self.sessions = sessions

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if scope["type"] != "http":  # This app has no WebSockets, so nothing may open one past these checks.
            await send({"type": "websocket.close", "code": 1008})
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {name.lower() for name, _ in message.get("headers", [])}
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(k, v) for k, v in _SECURITY_HEADERS.items() if k not in present]
            await send(message)

        async def refuse(status: int, code: str, reason: str) -> None:
            body = json.dumps({"code": code, "message": reason}).encode()
            await send_with_headers({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})

        headers = dict(scope["headers"])
        reason = _refusal(scope, headers)
        if reason is not None:
            await refuse(403, "forbidden", reason)
        elif (scope["method"], scope["path"]) in PUBLIC or await run_in_threadpool(auth.session_is_valid, self.sessions, _session_token(headers)):
            await self.app(scope, receive, send_with_headers)
        else:
            await refuse(401, "signed_out", "Sign in to reach your archive.")
