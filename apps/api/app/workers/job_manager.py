from __future__ import annotations

import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.db.repository import (
    create_job_v2,
    create_study_v2,
    get_benchmark_v2,
    get_job_v2,
    get_outcomes_by_job_v2,
    get_outcomes_by_study_v2,
    get_study_v2,
    save_outcome_v2,
    update_job_v2,
)
from app.models.contracts import (
    BenchmarkResponse,
    JobStageV2,
    JobStateV2,
    JobStatusV2,
    OutcomeMetricsV2,
    OutcomeV2,
    RunOptions,
    StudyCreateRequest,
    StudyDefinition,
)
from app.solver.fusion_solver import FusionApproxSolver
from app.solver.interfaces import SolverAdapter
from app.solver.normalization import normalize_study
from app.utils.encoding import bytes_to_b64


def _row_to_outcome(row: dict) -> OutcomeV2:
    glb_bytes = Path(row["glb_path"]).read_bytes()
    return OutcomeV2(
        id=row["outcome_id"],
        optimizedModel={"format": "glb", "dataBase64": bytes_to_b64(glb_bytes)},
        metrics=OutcomeMetricsV2(**row["metrics"]),
        variantParams=row["params"],
        warnings=row["warnings"],
    )


class JobManager:
    def __init__(self, solver: Optional[SolverAdapter] = None) -> None:
        self._solver: SolverAdapter = solver or FusionApproxSolver()
        self._solver_version = getattr(self._solver, "solver_version", "opentos-v2.0.0")
        self._executor = ThreadPoolExecutor(max_workers=settings.max_workers)

    def create_study(self, request: StudyCreateRequest) -> StudyDefinition:
        study_id, created_at = create_study_v2(request.model_dump(mode="json"))
        return StudyDefinition(id=study_id, createdAt=created_at, **request.model_dump(mode="json"))

    def get_study(self, study_id: str) -> StudyDefinition | None:
        row = get_study_v2(study_id)
        if not row:
            return None
        return StudyDefinition(id=row["id"], createdAt=row["created_at"], **row["request"])

    def run_study(self, study_id: str, run_options: RunOptions) -> str:
        study = self.get_study(study_id)
        if study is None:
            raise ValueError(f"Study '{study_id}' not found")
        job_id = create_job_v2(study_id, run_options.model_dump(mode="json"), self._solver_version)
        self._executor.submit(self._run_job, job_id, study, run_options)
        return job_id

    def get_status(self, job_id: str) -> JobStatusV2 | None:
        job_row = get_job_v2(job_id)
        if not job_row:
            return None

        outcomes = None
        if job_row["status"] == JobStateV2.succeeded.value:
            outcomes = [_row_to_outcome(row) for row in get_outcomes_by_job_v2(job_id)]

        return JobStatusV2(
            jobId=job_id,
            studyId=job_row["study_id"],
            status=JobStateV2(job_row["status"]),
            stage=JobStageV2(job_row["stage"]),
            progress=float(job_row["progress"]),
            etaSeconds=job_row["eta_seconds"],
            warnings=job_row["warnings"],
            solverVersion=job_row["solver_version"],
            error=job_row["error"],
            outcomes=outcomes,
        )

    def get_outcomes(self, study_id: str) -> list[OutcomeV2]:
        rows = get_outcomes_by_study_v2(study_id)
        return [_row_to_outcome(row) for row in rows]

    def get_benchmark(self, benchmark_id: str) -> BenchmarkResponse | None:
        row = get_benchmark_v2(benchmark_id)
        if row is None:
            return None
        return BenchmarkResponse(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            defaultStudy=row["default_study"],
            report=row["report"],
        )

    def _run_job(self, job_id: str, study: StudyDefinition, run_options: RunOptions) -> None:
        study_dir = settings.studies_root / study.id
        baseline_dir = study_dir / "baseline"
        outcomes_dir = study_dir / "outcomes"
        reports_dir = study_dir / "reports"
        baseline_dir.mkdir(parents=True, exist_ok=True)
        outcomes_dir.mkdir(parents=True, exist_ok=True)
        reports_dir.mkdir(parents=True, exist_ok=True)

        try:
            update_job_v2(
                job_id,
                status=JobStateV2.running.value,
                stage=JobStageV2.parse.value,
                progress=0.02,
                warnings=[],
            )
            normalized = normalize_study(StudyCreateRequest(**study.model_dump(mode="json", exclude={"id", "createdAt"})), run_options)

            def progress(stage: str, pct: float) -> None:
                mapped = {
                    "parse": JobStageV2.parse.value,
                    "constraint-map": JobStageV2.constraint_map.value,
                    "voxelize": JobStageV2.voxelize.value,
                    "fem-solve": JobStageV2.fem_solve.value,
                    "topology-opt": JobStageV2.topology_opt.value,
                    "reconstruct": JobStageV2.reconstruct.value,
                    "rank-export": JobStageV2.rank_export.value,
                }
                clamped = float(max(0.0, min(1.0, pct)))
                eta = max(0, int((1.0 - clamped) * 120))
                update_job_v2(
                    job_id,
                    status=JobStateV2.running.value,
                    stage=mapped.get(stage, JobStageV2.topology_opt.value),
                    progress=clamped,
                    eta_seconds=eta,
                )

            results = self._solver.solve(normalized, progress)
            warnings: list[str] = []
            if len(results) < max(1, normalized.outcome_count - 1):
                warnings.append(
                    f"Solver produced {len(results)} outcomes; uniqueness gate target was {max(1, normalized.outcome_count - 1)}."
                )

            for result in results[: normalized.outcome_count]:
                glb_path = outcomes_dir / f"{result.id}.glb"
                glb_path.write_bytes(result.glb_bytes)
                save_outcome_v2(study.id, job_id, result.id, glb_path, result.metrics, result.params, warnings)

            update_job_v2(
                job_id,
                status=JobStateV2.succeeded.value,
                stage=JobStageV2.complete.value,
                progress=1.0,
                eta_seconds=0,
                warnings=warnings,
                error=None,
            )
        except Exception as exc:
            traceback.print_exc()
            update_job_v2(
                job_id,
                status=JobStateV2.failed.value,
                stage=JobStageV2.failed.value,
                progress=1.0,
                eta_seconds=0,
                warnings=[str(exc)],
                error=str(exc),
            )
