"""Application factory."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from .api.documents import router as documents_router
from .config import Settings, load_settings, validate
from .db import make_engine, migrate
from .extraction.queue import ExtractionQueue
from .metadata import documents_to_resume, process_document
from .schemas import Status
from .security import LocalOnlyMiddleware
from .storage import OriginalStore, UploadRejected


def create_app(settings: Settings) -> FastAPI:
    validate(settings)
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    settings.data_dir.chmod(0o700)
    engine = make_engine(settings.database_path)
    migrate(engine)
    store = OriginalStore(settings.originals_dir, settings.incoming_dir)
    store.discard_incomplete()

    # The bundled API docs pages load scripts from a CDN, so they stay off.
    app = FastAPI(title="This Is You", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.store = store
    app.state.engine = engine
    app.state.sessions = sessionmaker(engine, expire_on_commit=False)
    app.state.extraction = ExtractionQueue(lambda document_id: process_document(app.state.sessions, store, settings.extraction_limits, document_id))
    for document_id in documents_to_resume(app.state.sessions):
        app.state.extraction.enqueue(document_id)
    app.add_middleware(LocalOnlyMiddleware)
    app.include_router(documents_router)

    @app.exception_handler(UploadRejected)
    async def rejected(_request: Request, exc: UploadRejected) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.get("/api/status", response_model=Status)
    def status() -> Status:
        return Status(status="ok", max_upload_bytes=settings.max_upload_bytes)

    return app


def app_factory() -> FastAPI:
    return create_app(load_settings())
