"""HTTP routes for documents."""
from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Header, Path, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from starlette.requests import ClientDisconnect

from .. import documents as service
from ..schemas import DocumentDetail, DocumentList, DocumentOut, ImportEventOut, UploadResult
from ..storage import UploadRejected, too_large

router = APIRouter(prefix="/api/documents")

DocumentId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


def _not_found() -> UploadRejected:
    return UploadRejected(404, "not_found", "No such document.")


@router.get("", response_model=DocumentList)
def list_documents(request: Request) -> DocumentList:
    return DocumentList(documents=[DocumentOut.of(d) for d in service.list_documents(request.app.state.sessions)])


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
    return UploadResult(duplicate=duplicate, document=DocumentOut.of(document))


@router.get("/{document_id}", response_model=DocumentDetail)
def get_document(request: Request, document_id: DocumentId) -> DocumentDetail:
    document = service.get_document(request.app.state.sessions, document_id)
    if document is None:
        raise _not_found()
    imports = [ImportEventOut(submitted_filename=e.submitted_filename, outcome=e.outcome.value, occurred_at=e.occurred_at) for e in document.imports]
    return DocumentDetail(**DocumentOut.of(document).model_dump(), imports=imports)


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
