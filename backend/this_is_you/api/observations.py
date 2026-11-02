"""HTTP routes for laboratory observations."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import observations as service
from ..lab_catalog import TESTS
from ..models import RevisionAction
from ..schemas import LabTestOut, ObservationList, ObservationOut
from .documents import read_json

router = APIRouter(prefix="/api")

ObservationId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


class ManualBody(BaseModel):
    fields: dict
    document_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    verify: bool = False


class CorrectionBody(BaseModel):
    fields: dict


class BatchBody(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


def _one(request: Request, observation_id: str) -> ObservationOut:
    sessions = request.app.state.sessions
    return ObservationOut.of(service.get_observation(sessions, observation_id), service.possible_duplicates(service.list_observations(sessions)))


@router.get("/lab-tests", response_model=list[LabTestOut])
def lab_tests() -> list[LabTestOut]:
    return [LabTestOut(code=t.code, name=t.name, short=t.short, unit=t.unit) for t in TESTS]


@router.get("/observations", response_model=ObservationList)
def list_all(request: Request) -> ObservationList:
    all_rows = service.list_observations(request.app.state.sessions)
    duplicates = service.possible_duplicates(all_rows)
    return ObservationList(observations=[ObservationOut.of(o, duplicates) for o in all_rows])


@router.post("/observations", response_model=ObservationOut, status_code=201)
async def create(request: Request) -> ObservationOut:
    body = await read_json(request, ManualBody)
    new_id = await run_in_threadpool(service.create_manual, request.app.state.sessions, service.ManualEntry(body.fields, body.document_id, body.verify))
    return await run_in_threadpool(_one, request, new_id)


@router.get("/observations/{observation_id}", response_model=ObservationOut)
def get_one(request: Request, observation_id: ObservationId) -> ObservationOut:
    return _one(request, observation_id)


@router.post("/observations/{observation_id}/correct", response_model=ObservationOut)
async def correct(request: Request, observation_id: ObservationId) -> ObservationOut:
    body = await read_json(request, CorrectionBody)
    await run_in_threadpool(service.correct, request.app.state.sessions, observation_id, body.fields)
    return await run_in_threadpool(_one, request, observation_id)


@router.post("/observations/verify", response_model=ObservationList)
async def verify_batch(request: Request) -> ObservationList:
    """Explicit approval of the listed results. This is the only way an extracted result is published."""
    body = await read_json(request, BatchBody)
    await run_in_threadpool(service.set_status, request.app.state.sessions, body.ids, RevisionAction.VERIFIED)
    return await run_in_threadpool(list_all, request)


async def _transition(request: Request, observation_id: str, action: RevisionAction) -> ObservationOut:
    await run_in_threadpool(service.set_status, request.app.state.sessions, [observation_id], action)
    return await run_in_threadpool(_one, request, observation_id)


@router.post("/observations/{observation_id}/verify", response_model=ObservationOut)
async def verify(request: Request, observation_id: ObservationId) -> ObservationOut:
    return await _transition(request, observation_id, RevisionAction.VERIFIED)


@router.post("/observations/{observation_id}/reject", response_model=ObservationOut)
async def reject(request: Request, observation_id: ObservationId) -> ObservationOut:
    return await _transition(request, observation_id, RevisionAction.REJECTED)


@router.post("/observations/{observation_id}/reopen", response_model=ObservationOut)
async def reopen(request: Request, observation_id: ObservationId) -> ObservationOut:
    return await _transition(request, observation_id, RevisionAction.REOPENED)
