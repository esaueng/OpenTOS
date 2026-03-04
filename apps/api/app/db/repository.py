from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.database import db_conn


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_study(request_payload: dict[str, Any], units: str, material: str, target_safety_factor: float, outcome_count: int) -> str:
    study_id = f"study_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO studies (id, created_at, units, material, target_safety_factor, outcome_count, request_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                study_id,
                now,
                units,
                material,
                target_safety_factor,
                outcome_count,
                json.dumps(request_payload),
            ),
        )
    return study_id


def create_job(study_id: str) -> str:
    job_id = f"job_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO jobs (id, study_id, status, stage, progress, error, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, study_id, "queued", "queued", 0.0, None, now, now),
        )
    return job_id


def update_job(job_id: str, *, status: str | None = None, stage: str | None = None, progress: float | None = None, error: str | None = None) -> None:
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
    if error is not None:
        fields.append("error = ?")
        values.append(error)

    values.append(job_id)

    query = f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?"
    with db_conn() as conn:
        conn.execute(query, values)


def get_job(job_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    return dict(row)


def save_outcome(job_id: str, outcome_id: str, glb_path: Path, metrics: dict[str, float], params: dict[str, Any]) -> None:
    row_id = f"out_{uuid.uuid4().hex[:16]}"
    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO outcomes (id, job_id, outcome_id, glb_path, metrics_json, params_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                job_id,
                outcome_id,
                str(glb_path),
                json.dumps(metrics),
                json.dumps(params),
                _utc_now(),
            ),
        )


def get_outcomes(job_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT outcome_id, glb_path, metrics_json, params_json FROM outcomes WHERE job_id = ? ORDER BY outcome_id",
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
            }
        )
    return parsed
