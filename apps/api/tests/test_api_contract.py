from __future__ import annotations

import base64

from fastapi.testclient import TestClient

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
        "preservedRegions": [{"id": "p1", "faceIndices": [0]}],
        "forces": [{"point": [1, 1, 1], "direction": [1, 0, 0], "magnitude": 10, "unit": "lb"}],
        "material": "Aluminum 6061",
        "targetSafetyFactor": 2.0,
        "outcomeCount": 2,
    }


def test_materials_endpoint() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/materials")
        assert response.status_code == 200
        payload = response.json()
        assert payload["materials"][0]["name"] == "Aluminum 6061"


def test_solve_async_contract() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.post("/api/solve", json=_request_body())
        assert response.status_code == 202
        payload = response.json()
        assert "jobId" in payload
        assert payload["statusUrl"].endswith(payload["jobId"])


def test_solve_sync_contract() -> None:
    app = create_app()

    class FakeManager:
        def run_sync(self, _request):
            return [
                {
                    "id": "OUT-01",
                    "optimizedModel": {"format": "glb", "dataBase64": "AA=="},
                    "metrics": {
                        "volume": 1.0,
                        "mass": 2.0,
                        "stressProxy": 3.0,
                        "displacementProxy": 4.0,
                    },
                }
            ]

    with TestClient(app) as client:
        app.state.job_manager = FakeManager()
        response = client.post("/api/solve?wait=true", json=_request_body())
        assert response.status_code == 200
        payload = response.json()
        assert len(payload["outcomes"]) == 1
        assert payload["outcomes"][0]["optimizedModel"]["format"] == "glb"
