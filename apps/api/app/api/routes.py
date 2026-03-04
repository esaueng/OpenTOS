from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from app.core.materials import MATERIALS
from app.core.schema_validation import validate_solve_payload
from app.models.contracts import (
    JobStatusResponse,
    MaterialDef,
    MaterialsResponse,
    SolveAcceptedResponse,
    SolveRequest,
    SolveResponse,
)
from app.workers.job_manager import JobManager

router = APIRouter(prefix="/api", tags=["generative-design"])


def get_job_manager(request: Request) -> JobManager:
    return request.app.state.job_manager


@router.get("/materials", response_model=MaterialsResponse)
def list_materials() -> MaterialsResponse:
    materials = [
        MaterialDef(
            id=mat.id,
            name=mat.name,
            densityKgM3=mat.density_kg_m3,
            elasticModulusGPa=mat.elastic_modulus_gpa,
            yieldStrengthMPa=mat.yield_strength_mpa,
            default=mat.default,
        )
        for mat in MATERIALS.values()
    ]
    return MaterialsResponse(materials=materials)


@router.post(
    "/solve",
    response_model=SolveAcceptedResponse | SolveResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def solve_study(
    body: SolveRequest,
    request: Request,
    wait: bool = Query(default=False),
    manager: JobManager = Depends(get_job_manager),
) -> SolveAcceptedResponse | SolveResponse:
    validate_solve_payload(body.model_dump(mode="json"))

    if wait:
        outcomes = manager.run_sync(body)
        return JSONResponse(status_code=status.HTTP_200_OK, content=SolveResponse(outcomes=outcomes).model_dump(mode="json"))

    job_id = manager.create_and_enqueue(body)
    base = str(request.base_url).rstrip("/")
    return SolveAcceptedResponse(jobId=job_id, statusUrl=f"{base}/api/jobs/{job_id}")


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str, manager: JobManager = Depends(get_job_manager)) -> JobStatusResponse:
    response = manager.get_status(job_id)
    if response is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return response
