"""HTTP routes for provider connections. Every route needs a session except the provider's return, which needs its state."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from ..connectors import service
from ..connectors.service import ConnectorProblem

router = APIRouter(prefix="/api/connections")

ProviderKey = Annotated[str, Path(pattern=r"^[a-z0-9-]{1,40}$")]


class ConfirmBody(BaseModel):
    patient_fhir_id: str = Field(min_length=1, max_length=128)


def _connectors(request: Request) -> service.Connectors:
    return request.app.state.connectors


def problem_response(exc: ConnectorProblem) -> JSONResponse:
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)


@router.get("")
def list_connections(request: Request) -> dict:
    c = _connectors(request)
    return {"providers": service.overview(c), "redirect_uri": service.redirect_uri(c.settings), "provider_file_problem": c.provider_file_problem}


@router.post("/{key}/authorize")
async def authorize(request: Request, key: ProviderKey) -> dict:
    return {"authorize_url": await run_in_threadpool(service.start, _connectors(request), key)}


def _back_to_app(result: str) -> HTMLResponse:
    """A page that moves on to the app by itself, so the app loads as a visit from this site, not from the provider's.

    A redirect would keep the provider's page as the origin of the visit, and the app's own security checks refuse
    visits from other websites. Only a fixed word goes back, never anything the provider sent.
    """
    target = f"/#/sources?result={result}"
    return HTMLResponse(
        f'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url={target}">'
        f'<title>Returning to This Is You</title><p><a href="{target}">Continue to This Is You</a></p>'
    )


@router.get("/callback")
async def callback(request: Request, code: Annotated[str | None, Query(max_length=2048)] = None,
                   state: Annotated[str | None, Query(max_length=256)] = None,
                   error: Annotated[str | None, Query(max_length=128)] = None) -> HTMLResponse:
    try:
        result = await run_in_threadpool(service.finish, _connectors(request), code, state, error)
    except ConnectorProblem:
        result = "failed"
    return _back_to_app(result if result.replace("_", "").isalpha() else "failed")


@router.post("/{key}/confirm-identity")
async def confirm_identity(request: Request, key: ProviderKey, body: ConfirmBody) -> dict:
    await run_in_threadpool(service.confirm_identity, _connectors(request), key, body.patient_fhir_id)
    return list_connections(request)


@router.post("/{key}/sync")
async def sync(request: Request, key: ProviderKey) -> dict:
    run_id = await run_in_threadpool(service.synchronize, _connectors(request), key)
    return {"run_id": run_id, **list_connections(request)}


@router.post("/{key}/disconnect")
async def disconnect(request: Request, key: ProviderKey) -> dict:
    revoked = await run_in_threadpool(service.disconnect, _connectors(request), key)
    return {"revoked": revoked, **list_connections(request)}


@router.post("/{key}/delete-imported")
async def delete_imported(request: Request, key: ProviderKey) -> dict:
    deleted = await run_in_threadpool(service.delete_imported, _connectors(request), key)
    return {"deleted": deleted, **list_connections(request)}
