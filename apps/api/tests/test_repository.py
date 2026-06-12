from __future__ import annotations

import pytest

from app.core.config import settings
from app.db import repository
from app.db.database import init_db


@pytest.fixture()
def isolated_db(tmp_path):
    old = (settings.data_root, settings.studies_root, settings.sqlite_path)
    settings.data_root = tmp_path / "data"
    settings.studies_root = settings.data_root / "studies"
    settings.sqlite_path = settings.data_root / "opentos.db"
    init_db()
    try:
        yield
    finally:
        settings.data_root, settings.studies_root, settings.sqlite_path = old


def _study_payload() -> dict:
    return {
        "model": {"format": "obj", "dataBase64": "AA=="},
        "units": "mm",
        "designRegion": {"faceIndices": [0]},
        "preservedRegions": [{"id": "mountA", "faceIndices": [1]}],
        "obstacleRegions": [],
        "loadCases": [
            {
                "id": "LC-1",
                "fixedRegions": ["mountA"],
                "forces": [{"point": [0, 0, 0], "direction": [1, 0, 0], "magnitude": 5, "unit": "N"}],
            }
        ],
        "material": "PLA",
        "targets": {"safetyFactor": 2.0, "outcomeCount": 2, "massReductionGoalPct": 30.0},
    }


def test_job_lifecycle_roundtrip(isolated_db) -> None:
    study_id, _created_at = repository.create_study_v2(_study_payload())
    job_id = repository.create_job_v2(study_id, {"qualityProfile": "balanced"}, "solver-x")

    job = repository.get_job_v2(job_id)
    assert job is not None
    assert job["status"] == "queued"
    assert job["warnings"] == []
    assert job["run_options"] == {"qualityProfile": "balanced"}

    repository.update_job_v2(
        job_id, status="failed", stage="failed", progress=1.0, warnings=["boom"], error="boom"
    )
    failed = repository.get_job_v2(job_id)
    assert failed is not None
    assert failed["status"] == "failed"
    assert failed["stage"] == "failed"
    assert failed["error"] == "boom"
    assert failed["warnings"] == ["boom"]


def test_outcome_rows_roundtrip(isolated_db, tmp_path) -> None:
    study_id, _created_at = repository.create_study_v2(_study_payload())
    job_id = repository.create_job_v2(study_id, {}, "solver-x")

    glb = tmp_path / "OUT-01.glb"
    glb.write_bytes(b"glTF-test")
    metrics = {
        "baselineVolume": 1.0,
        "volume": 0.5,
        "mass": 0.2,
        "massReductionPct": 50.0,
        "stressProxy": 1.0,
        "displacementProxy": 0.1,
        "safetyIndexProxy": 3.0,
        "complianceProxy": 0.2,
    }
    repository.save_outcome_v2(study_id, job_id, "OUT-01", glb, metrics, {"threshold": 0.4}, [])

    by_job = repository.get_outcomes_by_job_v2(job_id)
    by_study = repository.get_outcomes_by_study_v2(study_id)
    assert len(by_job) == 1
    assert len(by_study) == 1
    assert by_job[0]["metrics"]["massReductionPct"] == 50.0
    assert by_job[0]["params"] == {"threshold": 0.4}
    assert by_job[0]["glb_path"] == str(glb)
