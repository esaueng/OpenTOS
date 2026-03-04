from __future__ import annotations

import sqlite3
from contextlib import contextmanager

from app.core.config import settings


def init_db() -> None:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    settings.studies_root.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(settings.sqlite_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS studies (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                units TEXT NOT NULL,
                material TEXT NOT NULL,
                target_safety_factor REAL NOT NULL,
                outcome_count INTEGER NOT NULL,
                request_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress REAL NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS outcomes (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                outcome_id TEXT NOT NULL,
                glb_path TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                params_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            )
            """
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
