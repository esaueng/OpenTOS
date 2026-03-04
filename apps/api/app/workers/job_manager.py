from __future__ import annotations

import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.db.repository import create_job, create_study, get_job, get_outcomes, save_outcome, update_job
from app.models.contracts import JobStage, JobState, JobStatusResponse, Outcome, OutcomeMetrics, SolveRequest
from app.solver.fusion_solver import FusionApproxSolver
from app.solver.interfaces import SolverAdapter
from app.solver.normalization import normalize_request
from app.utils.encoding import bytes_to_b64


class JobManager:
    def __init__(self, solver: Optional[SolverAdapter] = None) -> None:
        self._solver: SolverAdapter = solver or FusionApproxSolver()
        self._executor = ThreadPoolExecutor(max_workers=settings.max_workers)

    def create_and_enqueue(self, request: SolveRequest) -> str:
        study_id = create_study(
            request_payload=request.model_dump(mode="json"),
            units=request.units,
            material=request.material,
            target_safety_factor=request.targetSafetyFactor,
            outcome_count=request.outcomeCount,
        )
        job_id = create_job(study_id)
        self._executor.submit(self._run_job, job_id, study_id, request)
        return job_id

    def run_sync(self, request: SolveRequest) -> list[Outcome]:
        normalized = normalize_request(request)

        def _noop(_stage: str, _progress: float) -> None:
            return None

        results = self._solver.solve(normalized, _noop)
        return [
            Outcome(
                id=result.id,
                optimizedModel={"format": "glb", "dataBase64": bytes_to_b64(result.glb_bytes)},
                metrics=OutcomeMetrics(**result.metrics),
            )
            for result in results[: request.outcomeCount]
        ]

    def get_status(self, job_id: str) -> JobStatusResponse | None:
        job_row = get_job(job_id)
        if not job_row:
            return None

        outcomes = None
        if job_row["status"] == JobState.succeeded.value:
            outcomes = []
            for row in get_outcomes(job_id):
                glb_bytes = Path(row["glb_path"]).read_bytes()
                outcomes.append(
                    Outcome(
                        id=row["outcome_id"],
                        optimizedModel={"format": "glb", "dataBase64": bytes_to_b64(glb_bytes)},
                        metrics=OutcomeMetrics(**row["metrics"]),
                    )
                )

        return JobStatusResponse(
            jobId=job_id,
            status=JobState(job_row["status"]),
            stage=JobStage(job_row["stage"]),
            progress=float(job_row["progress"]),
            error=job_row["error"],
            outcomes=outcomes,
        )

    def _run_job(self, job_id: str, study_id: str, request: SolveRequest) -> None:
        study_dir = settings.studies_root / study_id
        outcomes_dir = study_dir / "outcomes"
        outcomes_dir.mkdir(parents=True, exist_ok=True)

        try:
            update_job(job_id, status=JobState.running.value, stage=JobStage.parse.value, progress=0.02)
            normalized = normalize_request(request)

            def progress(stage: str, pct: float) -> None:
                mapped = {
                    "parse": JobStage.parse.value,
                    "voxelize": JobStage.voxelize.value,
                    "field-solve": JobStage.field_solve.value,
                    "variant-synth": JobStage.variant_synth.value,
                    "export": JobStage.export.value,
                }
                update_job(
                    job_id,
                    status=JobState.running.value,
                    stage=mapped.get(stage, JobStage.variant_synth.value),
                    progress=float(max(0.0, min(1.0, pct))),
                )

            results = self._solver.solve(normalized, progress)

            for result in results[: request.outcomeCount]:
                glb_path = outcomes_dir / f"{result.id}.glb"
                glb_path.write_bytes(result.glb_bytes)
                save_outcome(job_id, result.id, glb_path, result.metrics, result.params)

            update_job(
                job_id,
                status=JobState.succeeded.value,
                stage=JobStage.complete.value,
                progress=1.0,
                error=None,
            )
        except Exception as exc:
            traceback.print_exc()
            update_job(
                job_id,
                status=JobState.failed.value,
                stage=JobStage.failed.value,
                progress=1.0,
                error=str(exc),
            )
