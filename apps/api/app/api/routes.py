from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.materials import MATERIALS
from app.core.schema_validation import validate_run_options_payload, validate_study_payload
from app.models.contracts import (
    BenchmarkResponse,
    JobStatusV2,
    MaterialDef,
    MaterialsResponse,
    OutcomesResponse,
    RunOptions,
    StudyCreateRequest,
    StudyCreateResponse,
    StudyDefinition,
    StudyRunResponse,
)
from app.workers.job_manager import JobManager

router = APIRouter(prefix="/api", tags=["generative-design-v2"])


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


@router.post("/studies", response_model=StudyCreateResponse)
def create_study(body: StudyCreateRequest, manager: JobManager = Depends(get_job_manager)) -> StudyCreateResponse:
    validate_study_payload(body.model_dump(mode="json", exclude_none=True))
    study = manager.create_study(body)
    return StudyCreateResponse(study=study)


@router.get("/studies/{study_id}", response_model=StudyDefinition)
def get_study(study_id: str, manager: JobManager = Depends(get_job_manager)) -> StudyDefinition:
    study = manager.get_study(study_id)
    if study is None:
        raise HTTPException(status_code=404, detail=f"Study '{study_id}' not found")
    return study


@router.post("/studies/{study_id}/run", response_model=StudyRunResponse)
def run_study(study_id: str, body: RunOptions, request: Request, manager: JobManager = Depends(get_job_manager)) -> StudyRunResponse:
    validate_run_options_payload(body.model_dump(mode="json", exclude_none=True))
    try:
        job_id = manager.run_study(study_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    base = str(request.base_url).rstrip("/")
    return StudyRunResponse(jobId=job_id, statusUrl=f"{base}/api/jobs/{job_id}")


@router.get("/jobs/{job_id}", response_model=JobStatusV2)
def get_job_status(job_id: str, manager: JobManager = Depends(get_job_manager)) -> JobStatusV2:
    response = manager.get_status(job_id)
    if response is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return response


@router.get("/studies/{study_id}/outcomes", response_model=OutcomesResponse)
def get_study_outcomes(study_id: str, manager: JobManager = Depends(get_job_manager)) -> OutcomesResponse:
    study = manager.get_study(study_id)
    if study is None:
        raise HTTPException(status_code=404, detail=f"Study '{study_id}' not found")
    return OutcomesResponse(studyId=study_id, outcomes=manager.get_outcomes(study_id))


@router.get("/benchmarks/{benchmark_id}", response_model=BenchmarkResponse)
def get_benchmark(benchmark_id: str, manager: JobManager = Depends(get_job_manager)) -> BenchmarkResponse:
    benchmark = manager.get_benchmark(benchmark_id)
    if benchmark is None:
        raise HTTPException(status_code=404, detail=f"Benchmark '{benchmark_id}' not found")
    return benchmark
