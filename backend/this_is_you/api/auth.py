"""Signing in and out. There is deliberately no route that sets a passphrase: see auth.py."""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import auth
from ..storage import UploadRejected
from .documents import read_json

router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    passphrase: str = Field(max_length=auth.MAX_PASSPHRASE * 4)


def _cookie(request: Request) -> dict:
    production = request.app.state.settings.production
    return {"key": auth.SECURE_COOKIE if production else auth.COOKIE, "path": "/", "httponly": True, "samesite": "strict", "secure": production}


def _clear_cookie(request: Request, response: Response) -> None:
    response.delete_cookie(**_cookie(request))


@router.post("/login", status_code=204)
async def login(request: Request, response: Response) -> None:
    state = request.app.state
    body = await read_json(request, LoginBody)
    if not await run_in_threadpool(auth.is_configured, state.sessions):
        raise UploadRejected(409, "setup_required", "No passphrase has been set yet.")
    if wait := state.login_throttle.wait_seconds():
        raise UploadRejected(429, "too_many_tries", f"Too many wrong tries. Try again in {wait} seconds.")
    if not await run_in_threadpool(state.login_throttle.attempt, state.sessions, body.passphrase):
        raise UploadRejected(401, "wrong_passphrase", "That passphrase is not right.")
    token = await run_in_threadpool(auth.create_session, state.sessions)
    response.set_cookie(value=token, max_age=auth.ABSOLUTE_SECONDS, **_cookie(request))


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    auth.end_session(request.app.state.sessions, request.cookies.get(_cookie(request)["key"]))
    _clear_cookie(request, response)


@router.post("/logout-everywhere", status_code=204)
def logout_everywhere(request: Request, response: Response) -> None:
    auth.end_all_sessions(request.app.state.sessions)
    _clear_cookie(request, response)
