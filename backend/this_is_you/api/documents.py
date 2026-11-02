"""HTTP routes for documents."""
from __future__ import annotations

import json
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Header, Path, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from starlette.requests import ClientDisconnect

from .. import documents as service
from .. import metadata
from ..models import DecisionAction, Document, MetadataField
from ..schemas import DecisionOut, DocumentDetail, DocumentList, DocumentOut, ImportEventOut, RunOut, UploadResult
from ..storage import UploadRejected, too_large

router = APIRouter(prefix="/api/documents")

DocumentId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


def _not_found() -> UploadRejected:
    return UploadRejected(404, "not_found", "No such document.")


def _detail(request: Request, document_id: str) -> DocumentDetail:
    sessions = request.app.state.sessions
    document: Document | None = service.get_document(sessions, document_id)
    if document is None:
        raise _not_found()
    return DocumentDetail(
        **DocumentOut.of(document, metadata.possible_duplicates(sessions)).model_dump(),
        imports=[ImportEventOut(submitted_filename=e.submitted_filename, outcome=e.outcome.value, occurred_at=e.occurred_at) for e in document.imports],
        decisions=[DecisionOut.of(d) for d in document.decisions],
        runs=[RunOut(method=r.method, status=r.status.value, finished_at=r.finished_at, page_count=r.page_count, pages_read=r.pages_read) for r in document.runs],
    )


MAX_JSON_BYTES = 16 * 1024


async def read_json(request: Request, model: type[BaseModel]):
    """Reads a small JSON body, stopping as soon as it passes the cap."""
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_JSON_BYTES:
            raise UploadRejected(413, "too_large", "This request is too large.")
    try:
        return model.model_validate(json.loads(body))
    except (ValueError, ValidationError):
        raise UploadRejected(422, "invalid_value", "This request could not be understood.") from None


class DecisionBody(BaseModel):
    action: DecisionAction
    value: str | None = None
    proposal_id: int | None = None


class ReviewBody(BaseModel):
    complete: bool


@router.get("", response_model=DocumentList)
def list_documents(request: Request) -> DocumentList:
    sessions = request.app.state.sessions
    duplicates = metadata.possible_duplicates(sessions)
    return DocumentList(documents=[DocumentOut.of(d, duplicates) for d in service.list_documents(sessions)])


@router.post("", response_model=UploadResult, status_code=201)
async def upload_document(
    request: Request,
    response: Response,
    x_original_filename: Annotated[str | None, Header()] = None,
    content_type: Annotated[str | None, Header()] = None,
    content_length: Annotated[int | None, Header()] = None,
) -> UploadResult:
    """Accept one PDF as the raw request body.

    Not multipart, because parsers spool uploads to the system temp directory. Here the bytes only
    ever touch the archive's own private directory. The filename is a header so that it stays out
    of URLs and therefore out of any log that records them.
    """
    state = request.app.state
    limit = state.settings.max_upload_bytes
    if content_length is not None and content_length > limit:
        raise too_large(limit)
    if content_type != service.PDF_MEDIA_TYPE:
        raise UploadRejected(415, "not_pdf", "Only PDF files can be imported in this version. Nothing was stored.")
    filename = service.clean_filename(x_original_filename)
    try:
        received = await state.store.receive_pdf(request.stream(), limit)
    except ClientDisconnect:
        raise UploadRejected(400, "disconnected", "The upload was interrupted. Nothing was stored.") from None
    document, duplicate = await run_in_threadpool(service.record_upload, state.sessions, state.store, received, filename)
    if duplicate:
        response.status_code = 200
    else:
        state.extraction.enqueue(document.id)  # Identical bytes were read the first time, so duplicates are not.
    return UploadResult(duplicate=duplicate, document=DocumentOut.of(document))


@router.get("/{document_id}", response_model=DocumentDetail)
def get_document(request: Request, document_id: DocumentId) -> DocumentDetail:
    return _detail(request, document_id)


@router.get("/{document_id}/content")
def get_content(request: Request, document_id: DocumentId, download: bool = False) -> FileResponse:
    """The original bytes, always as a PDF so that a browser never treats them as anything else."""
    state = request.app.state
    document = service.get_document(state.sessions, document_id)
    if document is None:
        raise _not_found()
    path = state.store.path_for(document.storage_key)
    if not path.is_file():
        raise UploadRejected(404, "original_missing", "The original file is missing from the archive folder.")
    disposition = "attachment" if download else "inline"
    return FileResponse(
        path,
        media_type=service.PDF_MEDIA_TYPE,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(document.original_filename, safe='')}",
            # Only this app may frame the file, and any scripts inside a PDF get no network access.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        },
    )


@router.post("/{document_id}/metadata/{field}", response_model=DocumentDetail)
async def decide_field(request: Request, document_id: DocumentId, field: MetadataField) -> DocumentDetail:
    """Record what a person decided about one detail. The original file is not involved."""
    body = await read_json(request, DecisionBody)
    decision = metadata.DecisionRequest(action=body.action, value=body.value, proposal_id=body.proposal_id)
    await run_in_threadpool(metadata.decide, request.app.state.sessions, document_id, field, decision)
    return await run_in_threadpool(_detail, request, document_id)


@router.post("/{document_id}/review", response_model=DocumentDetail)
async def set_review(request: Request, document_id: DocumentId) -> DocumentDetail:
    body = await read_json(request, ReviewBody)
    await run_in_threadpool(metadata.set_review, request.app.state.sessions, document_id, body.complete)
    return await run_in_threadpool(_detail, request, document_id)


@router.post("/{document_id}/extract", response_model=DocumentDetail)
def read_again(request: Request, document_id: DocumentId) -> DocumentDetail:
    """Read the file again. Adds new proposals and leaves every decision in place."""
    metadata.request_reread(request.app.state.sessions, document_id)
    request.app.state.extraction.enqueue(document_id)
    return _detail(request, document_id)
