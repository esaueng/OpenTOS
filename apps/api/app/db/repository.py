from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.database import db_conn


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_study_v2(request_payload: dict[str, Any]) -> tuple[str, str]:
    study_id = f"study_{uuid.uuid4().hex[:16]}"
    now = _utc_now()

    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO studies_v2 (
                id, created_at, units, material, target_safety_factor,
                mass_reduction_goal_pct, outcome_count, request_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                study_id,
                now,
                request_payload["units"],
                request_payload["material"],
                request_payload["targets"]["safetyFactor"],
                request_payload["targets"]["massReductionGoalPct"],
                request_payload["targets"]["outcomeCount"],
                json.dumps(request_payload),
            ),
        )

        conn.execute(
            """
            INSERT INTO study_constraints_v2 (
                id, study_id, design_face_indices_json, preserved_regions_json, obstacle_regions_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                f"const_{uuid.uuid4().hex[:16]}",
                study_id,
                json.dumps(request_payload["designRegion"]["faceIndices"]),
                json.dumps(request_payload["preservedRegions"]),
                json.dumps(request_payload["obstacleRegions"]),
                now,
            ),
        )

        for load_case in request_payload["loadCases"]:
            conn.execute(
                """
                INSERT INTO study_loadcases_v2 (
                    id, study_id, loadcase_id, fixed_regions_json, forces_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    f"lc_{uuid.uuid4().hex[:16]}",
                    study_id,
                    load_case["id"],
                    json.dumps(load_case["fixedRegions"]),
                    json.dumps(load_case["forces"]),
                    now,
                ),
            )

    return study_id, now


def get_study_v2(study_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        row = conn.execute("SELECT id, created_at, request_json FROM studies_v2 WHERE id = ?", (study_id,)).fetchone()
    if row is None:
        return None
    request_payload = json.loads(row["request_json"])
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "request": request_payload,
    }


def create_job_v2(study_id: str, run_options: dict[str, Any], solver_version: str) -> str:
    job_id = f"job_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO jobs_v2 (
                id, study_id, status, stage, progress, eta_seconds,
                warnings_json, solver_version, run_options_json, error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                study_id,
                "queued",
                "queued",
                0.0,
                None,
                json.dumps([]),
                solver_version,
                json.dumps(run_options),
                None,
                now,
                now,
            ),
        )
    return job_id


def update_job_v2(
    job_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress: float | None = None,
    eta_seconds: int | None = None,
    warnings: list[str] | None = None,
    error: str | None = None,
) -> None:
    fields: list[str] = ["updated_at = ?"]
    values: list[Any] = [_utc_now()]

    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if stage is not None:
        fields.append("stage = ?")
        values.append(stage)
    if progress is not None:
        fields.append("progress = ?")
        values.append(progress)
    if eta_seconds is not None:
        fields.append("eta_seconds = ?")
        values.append(eta_seconds)
    if warnings is not None:
        fields.append("warnings_json = ?")
        values.append(json.dumps(warnings))
    if error is not None:
        fields.append("error = ?")
        values.append(error)

    values.append(job_id)
    query = f"UPDATE jobs_v2 SET {', '.join(fields)} WHERE id = ?"
    with db_conn() as conn:
        conn.execute(query, values)


def get_job_v2(job_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM jobs_v2 WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["warnings"] = json.loads(result["warnings_json"])
    result["run_options"] = json.loads(result["run_options_json"])
    return result


def save_outcome_v2(
    study_id: str,
    job_id: str,
    outcome_id: str,
    glb_path: Path,
    metrics: dict[str, float],
    params: dict[str, Any],
    warnings: list[str],
) -> None:
    row_id = f"out_{uuid.uuid4().hex[:16]}"
    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO outcomes_v2 (
                id, study_id, job_id, outcome_id, glb_path, metrics_json, params_json, warnings_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                study_id,
                job_id,
                outcome_id,
                str(glb_path),
                json.dumps(metrics),
                json.dumps(params),
                json.dumps(warnings),
                _utc_now(),
            ),
        )


def get_outcomes_by_job_v2(job_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT outcome_id, glb_path, metrics_json, params_json, warnings_json
            FROM outcomes_v2
            WHERE job_id = ?
            ORDER BY outcome_id
            """,
            (job_id,),
        ).fetchall()

    parsed: list[dict[str, Any]] = []
    for row in rows:
        parsed.append(
            {
                "outcome_id": row["outcome_id"],
                "glb_path": row["glb_path"],
                "metrics": json.loads(row["metrics_json"]),
                "params": json.loads(row["params_json"]),
                "warnings": json.loads(row["warnings_json"]),
            }
        )
    return parsed


def get_outcomes_by_study_v2(study_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT outcome_id, glb_path, metrics_json, params_json, warnings_json
            FROM outcomes_v2
            WHERE study_id = ?
            ORDER BY created_at, outcome_id
            """,
            (study_id,),
        ).fetchall()

    parsed: list[dict[str, Any]] = []
    for row in rows:
        parsed.append(
            {
                "outcome_id": row["outcome_id"],
                "glb_path": row["glb_path"],
                "metrics": json.loads(row["metrics_json"]),
                "params": json.loads(row["params_json"]),
                "warnings": json.loads(row["warnings_json"]),
            }
        )
    return parsed


def get_benchmark_v2(benchmark_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT id, name, description, default_study_json, report_json
            FROM benchmarks_v2
            WHERE id = ?
            """,
            (benchmark_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "default_study": json.loads(row["default_study_json"]),
        "report": json.loads(row["report_json"]),
    }
