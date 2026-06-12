from __future__ import annotations

import base64
import time
from pathlib import Path

import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import create_app


def _sample_obj_b64() -> str:
    obj = """
v 0 0 0
v 10 0 0
v 0 10 0
v 0 0 10
f 1 2 3
f 1 2 4
f 1 3 4
f 2 3 4
""".strip()
    return base64.b64encode(obj.encode("utf-8")).decode("utf-8")


def _request_body() -> dict:
    return {
        "model": {"format": "obj", "dataBase64": _sample_obj_b64()},
        "units": "mm",
        "designRegion": {"faceIndices": [0, 1, 2, 3]},
        "preservedRegions": [{"id": "mountA", "faceIndices": [0]}],
        "obstacleRegions": [],
        "loadCases": [
            {
                "id": "LC-1",
                "fixedRegions": ["mountA"],
                "forces": [{"point": [1, 1, 1], "direction": [1, 0, 0], "magnitude": 10, "unit": "lb", "label": "F-1"}],
            }
        ],
        "material": "Aluminum 6061",
        "targets": {"safetyFactor": 2.0, "outcomeCount": 2, "massReductionGoalPct": 45},
    }


class FakeManager:
    def create_study(self, request):
        return {
            **request.model_dump(mode="json"),
            "id": "study_test",
            "createdAt": "2026-03-05T00:00:00+00:00",
        }

    def get_study(self, study_id: str):
        if study_id != "study_test":
            return None
        body = _request_body()
        return {
            **body,
            "id": "study_test",
            "createdAt": "2026-03-05T00:00:00+00:00",
        }

    def run_study(self, study_id: str, _run_options):
        if study_id != "study_test":
            raise ValueError("missing")
        return "job_test"

    def get_status(self, job_id: str):
        if job_id != "job_test":
            return None
        return {
            "jobId": "job_test",
            "studyId": "study_test",
            "status": "succeeded",
            "stage": "complete",
            "progress": 1.0,
            "etaSeconds": 0,
            "warnings": [],
            "solverVersion": "opentos-v2",
            "outcomes": [
                {
                    "id": "OUT-01",
                    "optimizedModel": {"format": "glb", "dataBase64": "AA=="},
                    "metrics": {
                        "baselineVolume": 10.0,
                        "volume": 5.0,
                        "mass": 2.0,
                        "massReductionPct": 50.0,
                        "stressProxy": 3.0,
                        "displacementProxy": 4.0,
                        "safetyIndexProxy": 2.1,
                        "complianceProxy": 1.3,
                    },
                    "variantParams": {"threshold": 0.5},
                    "warnings": [],
                }
            ],
        }

    def get_outcomes(self, study_id: str):
        if study_id != "study_test":
            return []
        return self.get_status("job_test")["outcomes"]

    def get_benchmark(self, benchmark_id: str):
        if benchmark_id != "connecting-rod":
            return None
        return {
            "id": "connecting-rod",
            "name": "Connecting Rod Baseline",
            "description": "Reference benchmark template",
            "defaultStudy": {
                "units": "mm",
                "designRegion": {"faceIndices": [0]},
                "preservedRegions": [{"id": "mountA", "faceIndices": [1]}],
                "obstacleRegions": [],
                "loadCases": [
                    {
                        "id": "LC-1",
                        "fixedRegions": ["mountA"],
                        "forces": [{"point": [0, 0, 0], "direction": [1, 0, 0], "magnitude": 10, "unit": "lb", "label": "F-1"}],
                    }
                ],
                "material": "Aluminum 6061",
                "targets": {"safetyFactor": 2.0, "outcomeCount": 4, "massReductionGoalPct": 45.0},
            },
            "report": {
                "baselineVolume": 1.0,
                "targetMassReductionPct": 45.0,
                "notes": ["n1"],
            },
        }


def test_materials_endpoint() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/materials")
        assert response.status_code == 200
        payload = response.json()
        names = [material["name"] for material in payload["materials"]]
        assert "Aluminum 6061" in names
        assert "PLA" in names
        assert "PETG" in names
        assert "ABS" in names
        assert "ASA" in names
        assert "Nylon (PA12)" in names
        assert "Polycarbonate (PC)" in names


def test_study_create_get_run_and_job_contracts() -> None:
    app = create_app()
    with TestClient(app) as client:
        app.state.job_manager = FakeManager()

        create_response = client.post("/api/studies", json=_request_body())
        assert create_response.status_code == 200
        created = create_response.json()
        assert created["study"]["id"] == "study_test"

        get_response = client.get("/api/studies/study_test")
        assert get_response.status_code == 200
        assert get_response.json()["material"] == "Aluminum 6061"

        run_response = client.post("/api/studies/study_test/run", json={"qualityProfile": "balanced"})
        assert run_response.status_code == 200
        assert run_response.json()["jobId"] == "job_test"

        # Run options are optional; a bodyless run must use defaults.
        bodyless_run = client.post("/api/studies/study_test/run")
        assert bodyless_run.status_code == 200
        assert bodyless_run.json()["jobId"] == "job_test"

        status_response = client.get("/api/jobs/job_test")
        assert status_response.status_code == 200
        status_payload = status_response.json()
        assert status_payload["stage"] == "complete"
        assert len(status_payload["outcomes"]) == 1


def test_outcomes_and_benchmark_endpoints() -> None:
    app = create_app()
    with TestClient(app) as client:
        app.state.job_manager = FakeManager()

        outcomes_response = client.get("/api/studies/study_test/outcomes")
        assert outcomes_response.status_code == 200
        outcomes_payload = outcomes_response.json()
        assert outcomes_payload["studyId"] == "study_test"
        assert outcomes_payload["outcomes"][0]["metrics"]["massReductionPct"] == 50.0

        benchmark_response = client.get("/api/benchmarks/connecting-rod")
        assert benchmark_response.status_code == 200
        benchmark_payload = benchmark_response.json()
        assert benchmark_payload["id"] == "connecting-rod"


def test_benchmark_sample_study_runs_end_to_end(tmp_path) -> None:
    old_data_root = settings.data_root
    old_studies_root = settings.studies_root
    old_sqlite_path = settings.sqlite_path
    old_max_workers = settings.max_workers

    settings.data_root = tmp_path / "data"
    settings.studies_root = settings.data_root / "studies"
    settings.sqlite_path = settings.data_root / "opentos.db"
    settings.max_workers = 1

    try:
        app = create_app()
        sample_obj = Path(__file__).resolve().parents[3] / "assets" / "samples" / "connecting_rod_sample.obj"
        model_b64 = base64.b64encode(sample_obj.read_bytes()).decode("utf-8")

        with TestClient(app) as client:
            benchmark_response = client.get("/api/benchmarks/connecting-rod")
            assert benchmark_response.status_code == 200
            benchmark = benchmark_response.json()

            study_request = {
                **benchmark["defaultStudy"],
                "model": {"format": "obj", "dataBase64": model_b64},
            }

            create_response = client.post("/api/studies", json=study_request)
            assert create_response.status_code == 200
            study_id = create_response.json()["study"]["id"]

            run_response = client.post(
                f"/api/studies/{study_id}/run",
                json={"qualityProfile": "fast-preview", "outcomeCountOverride": 1, "seed": 0},
            )
            assert run_response.status_code == 200
            job_id = run_response.json()["jobId"]

            deadline = time.time() + 45
            final_payload = None
            while time.time() < deadline:
                status_response = client.get(f"/api/jobs/{job_id}")
                assert status_response.status_code == 200
                payload = status_response.json()
                if payload["status"] in {"succeeded", "failed", "canceled"}:
                    final_payload = payload
                    break
                time.sleep(0.25)

            assert final_payload is not None, "job did not finish before timeout"
            assert final_payload["status"] == "succeeded", final_payload.get("error") or final_payload.get("warnings")
            assert final_payload["outcomes"]
            assert final_payload["outcomes"][0]["optimizedModel"]["format"] == "glb"
            assert final_payload["outcomes"][0]["metrics"]["volume"] > 0

            outcomes_response = client.get(f"/api/studies/{study_id}/outcomes")
            assert outcomes_response.status_code == 200
            outcomes_payload = outcomes_response.json()
            assert len(outcomes_payload["outcomes"]) >= 1
    finally:
        settings.data_root = old_data_root
        settings.studies_root = old_studies_root
        settings.sqlite_path = old_sqlite_path
        settings.max_workers = old_max_workers
