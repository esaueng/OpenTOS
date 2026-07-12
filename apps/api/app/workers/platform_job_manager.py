from __future__ import annotations

import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings
from app.db.platform import PlatformRepository, utc_now
from app.models.contracts import RunOptions, StudyCreateRequest
from app.models.platform import (
    ArtifactRef,
    ConstraintCheck,
    OutcomeV3,
    RunCreate,
    SolverProvenance,
    SolverRun,
)
from app.services.platform_service import PlatformService
from app.solver.fusion_solver import FusionApproxSolver
from app.solver.normalization import normalize_study


class PlatformJobManager:
    """Durable run records with recoverable, process-local execution."""

    def __init__(self, platform: PlatformService) -> None:
        self.platform = platform
        self.repository: PlatformRepository = platform.repository
        self._solver = FusionApproxSolver()
        self._executor = ThreadPoolExecutor(max_workers=settings.max_workers, thread_name_prefix="opentos-run")

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)

    def create_run(self, project_id: str, study_id: str, options: RunCreate) -> SolverRun:
        study = self.platform.require_study(study_id)
        if study.projectId != project_id:
            raise ValueError("Study does not belong to this project")
        readiness = self.platform.readiness(study_id)
        if not readiness.ready:
            raise ValueError("Study is not ready: " + "; ".join(item["message"] for item in readiness.blockers))
        run = self.repository.create_run(project_id, study_id, options.model_dump(mode="json"))
        self._executor.submit(self._execute, run.id)
        return self.get_run(run.id)

    def get_run(self, run_id: str) -> SolverRun:
        record = self.repository.get_run(run_id)
        if record is None:
            raise LookupError(f"Run '{run_id}' not found")
        outcomes = [OutcomeV3(**row.payload) for row in self.repository.list_outcomes(run_id)]
        return SolverRun(
            id=record.id,
            projectId=record.project_id,
            studyId=record.study_id,
            state=record.state,
            stage=record.stage,
            progress=record.progress,
            createdAt=record.created_at,
            updatedAt=record.updated_at,
            etaSeconds=record.eta_seconds,
            error=record.error,
            warnings=record.warnings,
            outcomes=outcomes,
        )

    def cancel(self, run_id: str) -> SolverRun:
        record = self.repository.get_run(run_id)
        if record is None:
            raise LookupError(f"Run '{run_id}' not found")
        if record.state in {"queued", "running"}:
            self.repository.update_run(run_id, state="canceled", stage="failed", progress=1.0, eta_seconds=0)
        return self.get_run(run_id)

    def recover_interrupted(self) -> None:
        from sqlalchemy import select

        from app.db.platform import SolverRunRecord

        recovered: list[str] = []
        with self.repository.session() as session:
            rows = list(session.scalars(select(SolverRunRecord).where(SolverRunRecord.state.in_(["queued", "running"]))))
            for row in rows:
                row.state = "queued"
                row.stage = "queued"
                row.progress = 0.0
                row.eta_seconds = None
                row.error = None
                row.warnings = [*row.warnings, "Run restarted from its saved study after a service restart."]
                row.updated_at = utc_now()
                recovered.append(row.id)
        for run_id in recovered:
            self._executor.submit(self._execute, run_id)

    def _execute(self, run_id: str) -> None:
        record = self.repository.get_run(run_id)
        if record is None:
            return
        started_at = utc_now()
        try:
            self.repository.clear_outcomes(run_id)
            self.repository.update_run(run_id, state="running", stage="parse", progress=0.02, eta_seconds=120)
            study = self.platform.require_study(record.study_id)
            revision = self.repository.get_model_revision(study.modelRevisionId)
            if revision is None:
                raise RuntimeError("Study model revision is missing")
            source = self.repository.get_artifact(revision.artifact_id)
            if source is None:
                raise RuntimeError("Study source artifact is missing")
            model_bytes = self.platform.artifacts.read(source.storage_path)
            request = StudyCreateRequest(
                model={"format": revision.model_format, "dataBase64": base64.b64encode(model_bytes).decode("ascii")},
                units=study.units,
                designRegion=study.constraints.designRegion,
                preservedRegions=study.constraints.preservedRegions,
                obstacleRegions=study.constraints.obstacleRegions,
                loadCases=study.loadCases,
                material=study.material,
                targets=study.targets,
            )
            options = RunOptions(
                qualityProfile=record.options.get("qualityProfile", "balanced"),
                seed=record.options.get("seed", 0),
            )
            normalized = normalize_study(request, options)

            def progress(stage: str, value: float) -> None:
                current = self.repository.get_run(run_id)
                if current and current.state == "canceled":
                    raise RuntimeError("Run canceled")
                pct = max(0.0, min(0.98, float(value)))
                self.repository.update_run(
                    run_id,
                    state="running",
                    stage=stage,
                    progress=pct,
                    eta_seconds=max(0, int((1 - pct) * 120)),
                )

            results = self._solver.solve(normalized, progress)
            run_warnings: list[str] = []
            if record.options.get("verification") == "linear-static":
                run_warnings.append(
                    "Linear-static verification is not available for this adapter; outcomes remain explicitly marked as preview."
                )

            config_hash = hashlib.sha256(
                repr({"study": study.model_dump(mode="json"), "options": record.options}).encode("utf-8")
            ).hexdigest()
            completed_at = utc_now()
            for rank, result in enumerate(results, start=1):
                artifact = self.platform.artifacts.put(
                    kind="optimized-model",
                    file_name=f"{result.id}.glb",
                    content=result.glb_bytes,
                    media_type="model/gltf-binary",
                )
                artifact_row = self.repository.save_artifact(record.project_id, artifact)
                artifact_ref = self.platform.artifact_response(artifact_row)
                metrics = result.metrics
                checks = [
                    ConstraintCheck(
                        id="mass-target",
                        label="Mass reduction target",
                        status="pass" if metrics["massReductionPct"] >= study.targets.massReductionGoalPct else "warning",
                        actual=metrics["massReductionPct"],
                        target=study.targets.massReductionGoalPct,
                        unit="%",
                        message="Preview estimate only; verify against a linear-static analysis before release.",
                    ),
                    ConstraintCheck(
                        id="safety-target",
                        label="Safety factor target",
                        status="pass" if metrics["safetyIndexProxy"] >= study.targets.safetyFactor else "fail",
                        actual=metrics["safetyIndexProxy"],
                        target=study.targets.safetyFactor,
                        message="Safety index is a preview proxy and is not a certified factor of safety.",
                    ),
                ]
                provenance = SolverProvenance(
                    solver="OpenTOS Preview Solver",
                    version=getattr(self._solver, "solver_version", "opentos-preview"),
                    method="Voxel load-path synthesis",
                    fidelity="preview",
                    meshElements=int(result.params.get("voxelCount", 0)),
                    iterations=int(result.params.get("iterations", 0)),
                    converged=True,
                    startedAt=started_at,
                    completedAt=completed_at,
                    configurationHash=config_hash,
                )
                outcome_id = f"{run_id}_out_{rank:02d}"
                payload = OutcomeV3(
                    id=outcome_id,
                    runId=run_id,
                    rank=rank,
                    status="preview",
                    model=ArtifactRef(**artifact_ref.model_dump()),
                    metrics=metrics,
                    checks=checks,
                    provenance=provenance,
                    warnings=[*run_warnings, *(result.params.get("warnings", []) or [])],
                ).model_dump(mode="json")
                self.repository.save_outcome(
                    outcome_id=outcome_id,
                    run_id=run_id,
                    project_id=record.project_id,
                    artifact_id=artifact_row.id,
                    rank=rank,
                    status="preview",
                    payload=payload,
                )

            self.repository.update_run(
                run_id,
                state="succeeded",
                stage="complete",
                progress=1.0,
                eta_seconds=0,
                warnings=run_warnings,
                error=None,
            )
        except Exception as exc:
            current = self.repository.get_run(run_id)
            if current and current.state == "canceled":
                return
            self.repository.update_run(
                run_id,
                state="failed",
                stage="failed",
                progress=1.0,
                eta_seconds=0,
                error=str(exc),
                warnings=["The run failed before producing complete outcomes."],
            )
