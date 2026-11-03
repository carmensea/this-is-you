"""HTTP routes for batch imports and the identity profile."""
from __future__ import annotations

from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from starlette.requests import ClientDisconnect

from .. import documents as document_service
from .. import identity as identity_service
from .. import imports as service
from ..documents import utc_now
from ..identity import assess
from ..models import IdentityProfile, ImportItem, ImportItemState
from ..storage import UploadRejected, too_large
from .documents import read_json

router = APIRouter(prefix="/api")

BatchId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]
MAX_LISTING_BYTES = 2 * 1024 * 1024


class BatchBody(BaseModel):
    label: str = Field(max_length=2048)


class ListedFile(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    size: int = Field(ge=0)
    modified: int = Field(ge=0)


class ItemsBody(BaseModel):
    items: list[ListedFile] = Field(min_length=1, max_length=500)


class IdentityBody(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    date_of_birth: str | None = None
    previous_names: list[str] = Field(default_factory=list, max_length=10)


def _item_out(item: ImportItem, profile: identity_service.Profile | None) -> dict:
    d = item.document
    run = d.runs[-1] if d and d.runs else None
    return {
        "id": item.id, "path": item.path, "byte_size": item.byte_size, "modified": item.modified_ms, "state": item.state.value, "message": item.message, "attempts": item.attempts,
        "document_id": item.document_id, "document_filename": d.original_filename if d else None,
        "extraction_status": d.extraction_status.value if d else None, "review_status": d.review_status.value if d else None, "verification_status": d.verification_status.value if d else None,
        "pages_with_text": run.pages_with_text if run else 0, "page_count": run.page_count if run else None,
        "identity": assess(profile, run.patient_found if run else None).__dict__ if d else None,
    }


@router.post("/import-batches", status_code=201)
async def create_batch(request: Request) -> dict:
    body = await read_json(request, BatchBody)
    return {"id": await run_in_threadpool(service.create_batch, request.app.state.sessions, body.label)}


@router.get("/import-batches")
def list_batches(request: Request) -> dict:
    return {"batches": service.summaries(request.app.state.sessions)}


@router.post("/import-batches/{batch_id}/items")
async def add_items(request: Request, batch_id: BatchId) -> dict:
    state = request.app.state
    body = await read_json(request, ItemsBody, MAX_LISTING_BYTES)
    listed = [service.Listed(x.path, x.size, x.modified) for x in body.items]
    items = await run_in_threadpool(service.add_items, state.sessions, batch_id, listed, state.settings.max_upload_bytes)
    return {"items": [{"id": i.id, "path": i.path, "state": i.state.value} for i in items]}


@router.get("/import-batches/{batch_id}/items")
def list_items(
    request: Request,
    batch_id: BatchId,
    category: Annotated[str | None, Query(max_length=20)] = None,
    identity: Annotated[str | None, Query(max_length=20)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    sessions = request.app.state.sessions
    items, total = service.list_items(sessions, batch_id, category, identity, offset, limit)
    profile = identity_service.load_profile(sessions)
    return {"items": [_item_out(i, profile) for i in items], "total": total}


@router.post("/import-batches/{batch_id}/items/{item_id}/file")
async def upload_item(request: Request, batch_id: BatchId, item_id: int) -> dict:
    """One file of a batch, as the raw body. Repeating this for a stored file changes nothing."""
    state = request.app.state
    limit = state.settings.max_upload_bytes
    length = request.headers.get("content-length")
    item = await run_in_threadpool(service.begin_attempt, state.sessions, batch_id, item_id)
    profile = identity_service.load_profile(state.sessions)
    answer = lambda: _item_out(service.get_item(state.sessions, batch_id, item_id), profile)  # noqa: E731
    if item.state in (ImportItemState.STORED, ImportItemState.DUPLICATE):
        return await run_in_threadpool(answer)
    if item.state is ImportItemState.UNSUPPORTED:
        raise UploadRejected(409, "unsupported", "This file cannot be imported.")
    try:
        if length is not None and length.isdigit() and int(length) > limit:
            raise too_large(limit)
        filename = document_service.clean_filename(quote(item.path, safe=""))
        received = await state.store.receive_pdf(request.stream(), limit)
    except ClientDisconnect:
        await run_in_threadpool(service.mark_problem, state.sessions, item_id, ImportItemState.INTERRUPTED, "The upload stopped partway. Nothing was stored.")
        raise UploadRejected(400, "disconnected", "The upload was interrupted. Nothing was stored.") from None
    except UploadRejected as refused:
        await run_in_threadpool(service.mark_problem, state.sessions, item_id, ImportItemState.REJECTED, refused.message)
        return await run_in_threadpool(answer)
    document, duplicate = await run_in_threadpool(document_service.record_upload, state.sessions, state.store, received, filename, item_id)
    if not duplicate:
        state.extraction.enqueue(document.id)
    return await run_in_threadpool(answer)


@router.post("/import-batches/{batch_id}/retry-reading")
def retry_reading(request: Request, batch_id: BatchId, item: int | None = None) -> dict:
    """Reads failed files again. Files that never arrived need choosing again, so they are left to the app."""
    state = request.app.state
    documents = service.documents_to_reread(state.sessions, batch_id, item)
    for document_id in documents:
        state.extraction.enqueue(document_id)
    return {"requeued": len(documents)}


@router.post("/import-batches/{batch_id}/hide", status_code=204)
def hide(request: Request, batch_id: BatchId) -> None:
    service.hide_batch(request.app.state.sessions, batch_id)


# ---- Identity

def _profile_out(row: IdentityProfile | None) -> dict:
    if row is None:
        return {"full_name": "", "date_of_birth": None, "previous_names": [], "configured": False}
    return {"full_name": row.full_name, "date_of_birth": row.date_of_birth, "previous_names": row.previous_names, "configured": True}


@router.get("/identity")
def get_identity(request: Request) -> dict:
    with request.app.state.sessions() as session:
        return _profile_out(session.get(IdentityProfile, 1))


def _save_identity(sessions, body: IdentityBody) -> dict:
    name = " ".join(body.full_name.split())
    earlier = [" ".join(n.split()) for n in body.previous_names if n.strip()]
    if len(identity_service._tokens(name)) < 2:
        raise UploadRejected(422, "invalid_value", "Enter a given name and a family name.")
    birth = body.date_of_birth or None
    if birth is not None:
        try:
            if date.fromisoformat(birth) > date.today():
                raise ValueError
        except ValueError:
            raise UploadRejected(422, "invalid_value", "Enter the date of birth as a past date.") from None
    with sessions() as session:
        row = session.get(IdentityProfile, 1)
        if row is None:
            row = IdentityProfile(id=1, full_name=name, updated_at=utc_now())
            session.add(row)
        row.full_name, row.date_of_birth, row.previous_names, row.updated_at = name, birth, earlier, utc_now()
        session.commit()
        return _profile_out(row)


@router.put("/identity")
async def put_identity(request: Request) -> dict:
    body = await read_json(request, IdentityBody)
    return await run_in_threadpool(_save_identity, request.app.state.sessions, body)


