"""The JSON the frontend reads. Storage paths are deliberately absent."""
from __future__ import annotations

from pydantic import BaseModel

from .models import Document


class DocumentOut(BaseModel):
    id: str
    original_filename: str
    imported_at: str
    document_type: str
    processing_status: str
    media_type: str
    byte_size: int
    sha256: str
    content_url: str

    @classmethod
    def of(cls, d: Document) -> "DocumentOut":
        return cls(
            id=d.id, original_filename=d.original_filename, imported_at=d.imported_at, document_type=d.document_type.value,
            processing_status=d.processing_status.value, media_type=d.media_type, byte_size=d.byte_size, sha256=d.sha256,
            content_url=f"/api/documents/{d.id}/content",
        )


class ImportEventOut(BaseModel):
    submitted_filename: str
    outcome: str
    occurred_at: str


class DocumentDetail(DocumentOut):
    imports: list[ImportEventOut]


class DocumentList(BaseModel):
    documents: list[DocumentOut]


class UploadResult(BaseModel):
    duplicate: bool
    document: DocumentOut


class Status(BaseModel):
    status: str
    max_upload_bytes: int
