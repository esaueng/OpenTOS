from __future__ import annotations

import json
import time
from collections.abc import Iterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.ai.service import CopilotService
from app.core.config import settings
from app.models.platform import (
    CopilotRequest,
    CopilotResponse,
    ModelRevision,
    ProjectCreate,
    ProjectSummary,
    RunCreate,
    SolverRun,
    StudyDraft,
    StudyDraftCreate,
    StudyReadiness,
)
from app.services.platform_service import PlatformService
from app.workers.platform_job_manager import PlatformJobManager


router = APIRouter(prefix="/api/v3", tags=["platform-v3"])


def platform_service(request: Request) -> PlatformService:
    return request.app.state.platform_service


def platform_jobs(request: Request) -> PlatformJobManager:
    return request.app.state.platform_jobs


def copilot_service(request: Request) -> CopilotService:
    return request.app.state.copilot_service


def _not_found(exc: LookupError) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": str(exc)})


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": "invalid_request", "message": str(exc)})


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(service: PlatformService = Depends(platform_service)) -> list[ProjectSummary]:
    return service.list_projects()


@router.post("/projects", response_model=ProjectSummary, status_code=201)
def create_project(body: ProjectCreate, service: PlatformService = Depends(platform_service)) -> ProjectSummary:
    return service.create_project(body.name)


@router.post("/projects/{project_id}/models", response_model=ModelRevision, status_code=201)
async def upload_model(
    project_id: str,
    file: UploadFile = File(...),
    units: str = Form("mm"),
    service: PlatformService = Depends(platform_service),
) -> ModelRevision:
    if units not in {"mm", "in", "m"}:
        raise HTTPException(status_code=400, detail={"code": "invalid_units", "message": "Units must be mm, in, or m"})
    content = await file.read(settings.max_upload_bytes + 1)
    try:
        return service.add_model_revision(
            project_id=project_id,
            file_name=file.filename or "model.bin",
            content=content,
            units=units,
        )
    except LookupError as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/projects/{project_id}/studies", response_model=StudyDraft, status_code=201)
def create_study(
    project_id: str,
    body: StudyDraftCreate,
    service: PlatformService = Depends(platform_service),
) -> StudyDraft:
    try:
        return service.create_study(project_id, body)
    except LookupError as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.get("/studies/{study_id}", response_model=StudyDraft)
def get_study(study_id: str, service: PlatformService = Depends(platform_service)) -> StudyDraft:
    try:
        return service.require_study(study_id)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.get("/studies/{study_id}/readiness", response_model=StudyReadiness)
def get_readiness(study_id: str, service: PlatformService = Depends(platform_service)) -> StudyReadiness:
    try:
        return service.readiness(study_id)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.post("/projects/{project_id}/studies/{study_id}/runs", response_model=SolverRun, status_code=202)
def create_run(
    project_id: str,
    study_id: str,
    body: RunCreate,
    jobs: PlatformJobManager = Depends(platform_jobs),
) -> SolverRun:
    try:
        return jobs.create_run(project_id, study_id, body)
    except LookupError as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.get("/runs/{run_id}", response_model=SolverRun)
def get_run(run_id: str, jobs: PlatformJobManager = Depends(platform_jobs)) -> SolverRun:
    try:
        return jobs.get_run(run_id)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.post("/runs/{run_id}/cancel", response_model=SolverRun)
def cancel_run(run_id: str, jobs: PlatformJobManager = Depends(platform_jobs)) -> SolverRun:
    try:
        return jobs.cancel(run_id)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.get("/runs/{run_id}/events")
def run_events(run_id: str, jobs: PlatformJobManager = Depends(platform_jobs)) -> StreamingResponse:
    def events() -> Iterator[str]:
        last_payload = ""
        while True:
            try:
                run = jobs.get_run(run_id)
            except LookupError:
                yield "event: error\ndata: {\"code\":\"not_found\"}\n\n"
                return
            payload = run.model_dump_json()
            if payload != last_payload:
                yield f"event: run\ndata: {payload}\n\n"
                last_payload = payload
            if run.state in {"succeeded", "failed", "canceled"}:
                return
            time.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/artifacts/{artifact_id}")
def download_artifact(artifact_id: str, service: PlatformService = Depends(platform_service)) -> FileResponse:
    artifact = service.repository.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail={"code": "artifact_not_found", "message": "Artifact not found"})
    return FileResponse(artifact.storage_path, media_type=artifact.media_type, filename=artifact.file_name)


@router.post("/projects/{project_id}/copilot", response_model=CopilotResponse)
def copilot(
    project_id: str,
    body: CopilotRequest,
    service: CopilotService = Depends(copilot_service),
) -> CopilotResponse:
    try:
        return service.respond(project_id, body)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.post("/projects/{project_id}/copilot/events")
def copilot_events(
    project_id: str,
    body: CopilotRequest,
    service: CopilotService = Depends(copilot_service),
) -> StreamingResponse:
    def events() -> Iterator[str]:
        yield "event: status\ndata: {\"state\":\"thinking\"}\n\n"
        try:
            response = service.respond(project_id, body)
        except LookupError as exc:
            payload = json.dumps({"code": "not_found", "message": str(exc)})
            yield f"event: error\ndata: {payload}\n\n"
            return
        yield f"event: message\ndata: {response.model_dump_json()}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
