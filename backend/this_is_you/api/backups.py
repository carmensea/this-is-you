"""HTTP routes for backups. Restoring over an archive stays on the command line, with the service stopped."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..backup import on_same_drive
from ..extraction.sandbox import isolation
from ..storage import UploadRejected
from .documents import read_json

router = APIRouter(prefix="/api/backups")


class CheckBody(BaseModel):
    passphrase: str | None = Field(default=None, max_length=4096)


@router.get("")
def list_backups(request: Request) -> dict:
    jobs = request.app.state.backups
    current = jobs.current
    location = str(jobs.settings.backups_dir)
    home = str(Path.home())
    return {
        # No account name, which a screen or screenshot has no need to show.
        "location": "~" + location[len(home):] if location.startswith(home + "/") else location,
        "same_drive": on_same_drive(jobs.settings.backups_dir, jobs.settings.data_dir),
        "key_configured": jobs.key is not None,
        "backups": jobs.list(),
        "running": {k: current[k] for k in ("kind", "name", "done", "total") if k in current} if current else None,
        "last_result": jobs.last,
    }


@router.get("/archive-health")
def archive_health(request: Request) -> dict:
    state = request.app.state
    return {**vars(state.reconciled), "reader_isolation": isolation()}


@router.post("", status_code=202)
def start_backup(request: Request) -> dict:
    if not request.app.state.backups.start_backup():
        raise UploadRejected(409, "busy", "A backup or check is already running.")
    return {"started": True}


@router.post("/{name}/check", status_code=202)
async def start_check(request: Request, name: str) -> dict:
    """An encrypted backup needs its passphrase. It is used in memory for this one check and is never stored or logged."""
    try:
        request.app.state.backups.folder(name)
        body = await read_json(request, CheckBody)
        started = request.app.state.backups.start_check(name, body.passphrase)
    except KeyError:
        raise UploadRejected(404, "not_found", "No such backup.") from None
    if not started:
        raise UploadRejected(409, "busy", "A backup or check is already running.")
    return {"started": True}
