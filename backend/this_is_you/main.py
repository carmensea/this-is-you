"""Application factory."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from . import auth
from .api.auth import router as auth_router
from .api.backups import router as backups_router
from .api.connections import problem_response, router as connections_router
from .api.documents import router as documents_router
from .api.imports import router as imports_router
from .api.observations import router as observations_router
from .backup import BackupJobs, clear_leftovers
from .connectors import service as connectors
from .config import Settings, load_settings, validate
from .db import make_engine, migrate
from .extraction import sandbox
from .extraction.queue import ExtractionQueue
from .extraction.runner import ReaderUnavailable
from .metadata import documents_to_resume, process_document
from .documents import finish_deletions
from .reconcile import reconcile
from .schemas import Status
from .security import LocalOnlyMiddleware
from .storage import OriginalStore, UploadRejected


log = logging.getLogger("this_is_you.main")
READER_RETRY_SECONDS = 5


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
    clear_leftovers(settings)
    finish_deletions(app.state.sessions, store, settings.deleting_dir)  # Before recovery, which would bring the file back.
    app.state.reconciled = reconcile(settings, app.state.sessions)  # Before reading resumes, so recovered files get read.
    app.state.login_throttle = auth.LoginThrottle()
    sandbox.configure(settings.data_dir, settings.reader_must_be_sandboxed, settings.reader_socket)
    # Without the sandbox it must have, nothing is read. Files are still stored, stay queued, and are read after a fix and restart.
    reading_allowed = sandbox.isolation() != sandbox.UNAVAILABLE

    def read(document_id: str) -> None:
        if not reading_allowed:
            return
        try:
            process_document(app.state.sessions, store, settings.extraction_limits, document_id)
        except ReaderUnavailable:
            # The reader is restarting. Every document needs it, so waiting here holds them in order. Nothing is lost.
            log.warning("The reader container is not answering. Reading resumes when it does.")
            time.sleep(READER_RETRY_SECONDS)
            app.state.extraction.enqueue(document_id)

    app.state.extraction = ExtractionQueue(read)
    for document_id in documents_to_resume(app.state.sessions):
        app.state.extraction.enqueue(document_id)
    app.state.backups = BackupJobs(settings)
    connectors.mark_interrupted(app.state.sessions)
    app.state.connectors = connectors.Connectors(settings, app.state.sessions, store, app.state.extraction.enqueue)
    app.add_middleware(LocalOnlyMiddleware, sessions=app.state.sessions, settings=settings)
    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(observations_router)
    app.include_router(imports_router)
    app.include_router(backups_router)
    app.include_router(connections_router)
    app.add_exception_handler(connectors.ConnectorProblem, lambda _request, exc: problem_response(exc))

    @app.exception_handler(UploadRejected)
    async def rejected(_request: Request, exc: UploadRejected) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.get("/api/status", response_model=Status)
    def status() -> Status:
        return Status(status="ok", max_upload_bytes=settings.max_upload_bytes, passphrase_set=auth.is_configured(app.state.sessions))

    if settings.web_dir is not None:
        app.mount("/assets", StaticFiles(directory=settings.web_dir / "assets"))

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(settings.web_dir / "index.html")

    return app


def app_factory() -> FastAPI:
    return create_app(load_settings())
