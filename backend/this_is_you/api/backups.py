"""HTTP routes for backups. Restoring over an archive stays on the command line, with the service stopped."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ..storage import UploadRejected

router = APIRouter(prefix="/api/backups")


@router.get("")
def list_backups(request: Request) -> dict:
    jobs = request.app.state.backups
    current = jobs.current
    return {
        "location": str(jobs.settings.backups_dir),
        "backups": jobs.list(),
        "running": {k: current[k] for k in ("kind", "name", "done", "total") if k in current} if current else None,
        "last_result": jobs.last,
    }


@router.post("", status_code=202)
def start_backup(request: Request) -> dict:
    if not request.app.state.backups.start_backup():
        raise UploadRejected(409, "busy", "A backup or check is already running.")
    return {"started": True}


@router.post("/{name}/check", status_code=202)
def start_check(request: Request, name: str) -> dict:
    try:
        started = request.app.state.backups.start_check(name)
    except KeyError:
        raise UploadRejected(404, "not_found", "No such backup.") from None
    if not started:
        raise UploadRejected(409, "busy", "A backup or check is already running.")
    return {"started": True}
