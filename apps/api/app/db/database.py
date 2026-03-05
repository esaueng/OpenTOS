from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager

from app.core.config import settings


def init_db() -> None:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    settings.studies_root.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(settings.sqlite_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS studies_v2 (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                units TEXT NOT NULL,
                material TEXT NOT NULL,
                target_safety_factor REAL NOT NULL,
                mass_reduction_goal_pct REAL NOT NULL,
                outcome_count INTEGER NOT NULL,
                request_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS study_constraints_v2 (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                design_face_indices_json TEXT NOT NULL,
                preserved_regions_json TEXT NOT NULL,
                obstacle_regions_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies_v2(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS study_loadcases_v2 (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                loadcase_id TEXT NOT NULL,
                fixed_regions_json TEXT NOT NULL,
                forces_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies_v2(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs_v2 (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress REAL NOT NULL,
                eta_seconds INTEGER,
                warnings_json TEXT NOT NULL,
                solver_version TEXT NOT NULL,
                run_options_json TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies_v2(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS outcomes_v2 (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                job_id TEXT NOT NULL,
                outcome_id TEXT NOT NULL,
                glb_path TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                params_json TEXT NOT NULL,
                warnings_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(job_id) REFERENCES jobs_v2(id),
                FOREIGN KEY(study_id) REFERENCES studies_v2(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS benchmarks_v2 (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                default_study_json TEXT NOT NULL,
                report_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO benchmarks_v2 (
                id, name, description, default_study_json, report_json, created_at
            ) VALUES (
                'connecting-rod',
                'Connecting Rod Baseline',
                'Reference benchmark template for rod-style structural studies.',
                ?,
                ?,
                datetime('now')
            )
            """,
            (
                json.dumps(
                    {
                        "units": "mm",
                        "designRegion": {"faceIndices": [0]},
                        "preservedRegions": [{"id": "mountA", "faceIndices": [1]}],
                        "obstacleRegions": [],
                        "loadCases": [
                            {
                                "id": "LC-1",
                                "fixedRegions": ["mountA"],
                                "forces": [
                                    {"point": [0, 0, 0], "direction": [1, 0, 0], "magnitude": 10, "unit": "lb"}
                                ],
                            }
                        ],
                        "material": "Aluminum 6061",
                        "targets": {"safetyFactor": 2.0, "outcomeCount": 4, "massReductionGoalPct": 45.0},
                    }
                ),
                json.dumps(
                    {
                        "baselineVolume": 1.0,
                        "targetMassReductionPct": 45.0,
                        "notes": [
                            "Benchmark values are proxies for ranking and parity checks.",
                            "Use identical seed and quality profile for browser/API comparison."
                        ],
                    }
                ),
            ),
        )
        conn.commit()


@contextmanager
def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.sqlite_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
