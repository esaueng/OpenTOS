from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.ai.service import CopilotService
from app.core.config import AISettings, settings
from app.db.platform import PlatformRepository
from app.models.platform import (
    ConstraintSet,
    CopilotRequest,
    ManufacturingConstraints,
    StudyDraftCreate,
)
from app.services.platform_service import PlatformService
from app.storage.artifacts import FileSystemArtifactStore
from app.main import create_app


BOX_OBJ = b"""v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 3 2
f 1 4 3
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8
"""


def make_service(tmp_path: Path) -> PlatformService:
    repository = PlatformRepository(f"sqlite:///{tmp_path / 'platform.db'}")
    store = FileSystemArtifactStore(tmp_path / "artifacts")
    service = PlatformService(repository, store)
    service.initialize()
    return service


def create_ready_study(service: PlatformService) -> tuple[str, str]:
    project = service.create_project("Connecting Rod Study")
    revision = service.add_model_revision(
        project_id=project.id,
        file_name="box.obj",
        content=BOX_OBJ,
        units="mm",
    )
    study = service.create_study(
        project.id,
        StudyDraftCreate(
            modelRevisionId=revision.id,
            name="Baseline",
            units="mm",
            material="Aluminum 6061",
            constraints=ConstraintSet(
                designRegion={"faceIndices": list(range(1, 12))},
                preservedRegions=[{"id": "fixed-0", "faceIndices": [0]}],
                obstacleRegions=[],
            ),
            loadCases=[
                {
                    "id": "LC-1",
                    "fixedRegions": ["fixed-0"],
                    "forces": [
                        {
                            "point": [1, 1, 1],
                            "direction": [1, 0, 0],
                            "magnitude": 1000,
                            "unit": "N",
                        }
                    ],
                }
            ],
            targets={"safetyFactor": 2, "outcomeCount": 4, "massReductionGoalPct": 45},
            manufacturing=ManufacturingConstraints(minimumThickness=1, process="unconstrained"),
        ),
    )
    return project.id, study.id


def test_project_model_study_and_readiness_round_trip(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    project_id, study_id = create_ready_study(service)

    projects = service.list_projects()
    assert [project.id for project in projects] == [project_id]
    readiness = service.readiness(study_id)
    assert readiness.ready is True
    assert readiness.blockers == []

    study = service.require_study(study_id)
    revision = service.repository.get_model_revision(study.modelRevisionId)
    assert revision is not None
    assert revision.diagnostics["triangleCount"] == 12
    artifact = service.repository.get_artifact(revision.artifact_id)
    assert artifact is not None
    assert service.artifacts.read(artifact.storage_path) == BOX_OBJ


def test_copilot_falls_back_to_deterministic_readiness_without_key(tmp_path: Path, monkeypatch) -> None:
    service = make_service(tmp_path)
    project_id, study_id = create_ready_study(service)
    monkeypatch.setattr(
        settings,
        "ai",
        AISettings(
            provider="disabled",
            model="gpt-5.6-sol",
            reasoning_effort="xhigh",
            api_key=None,
            base_url=None,
            timeout_seconds=30,
        ),
    )

    response = CopilotService(service).respond(
        project_id,
        CopilotRequest(message="Review this setup", studyId=study_id),
    )
    assert response.model == "gpt-5.6-sol"
    assert "deterministic setup checks pass" in response.message
    assert response.proposedPatch == []


def test_artifact_store_rejects_paths_outside_root(tmp_path: Path) -> None:
    store = FileSystemArtifactStore(tmp_path / "artifacts")
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    try:
        store.read(outside)
    except ValueError:
        pass
    else:
        raise AssertionError("outside path should be rejected")


def test_v3_api_project_upload_study_and_problem_contract(tmp_path: Path, monkeypatch) -> None:
    data_root = tmp_path / "api-data"
    monkeypatch.setattr(settings, "data_root", data_root)
    monkeypatch.setattr(settings, "studies_root", data_root / "studies")
    monkeypatch.setattr(settings, "artifacts_root", data_root / "artifacts")
    monkeypatch.setattr(settings, "sqlite_path", data_root / "opentos.db")
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{data_root / 'opentos.db'}")
    monkeypatch.setattr(
        settings,
        "ai",
        AISettings(
            provider="disabled",
            model="gpt-5.6-sol",
            reasoning_effort="xhigh",
            api_key=None,
            base_url=None,
            timeout_seconds=30,
        ),
    )

    with TestClient(create_app()) as client:
        project_response = client.post("/api/v3/projects", json={"name": "Connecting Rod Study"})
        assert project_response.status_code == 201
        project = project_response.json()

        upload_response = client.post(
            f"/api/v3/projects/{project['id']}/models",
            data={"units": "mm"},
            files={"file": ("box.obj", BOX_OBJ, "model/obj")},
        )
        assert upload_response.status_code == 201
        revision = upload_response.json()
        assert revision["diagnostics"]["triangleCount"] == 12

        study_payload = {
            "modelRevisionId": revision["id"],
            "name": "Baseline",
            "units": "mm",
            "material": "Aluminum 6061",
            "constraints": {
                "designRegion": {"faceIndices": list(range(1, 12))},
                "preservedRegions": [{"id": "fixed-0", "faceIndices": [0]}],
                "obstacleRegions": [],
            },
            "loadCases": [
                {
                    "id": "LC-1",
                    "fixedRegions": ["fixed-0"],
                    "forces": [
                        {"point": [1, 1, 1], "direction": [1, 0, 0], "magnitude": 1000, "unit": "N"}
                    ],
                }
            ],
            "targets": {"safetyFactor": 2, "outcomeCount": 4, "massReductionGoalPct": 45},
            "manufacturing": {"minimumThickness": 1, "symmetry": "none", "process": "unconstrained"},
        }
        study_response = client.post(f"/api/v3/projects/{project['id']}/studies", json=study_payload)
        assert study_response.status_code == 201
        study = study_response.json()

        readiness = client.get(f"/api/v3/studies/{study['id']}/readiness")
        assert readiness.status_code == 200
        assert readiness.json()["ready"] is True

        missing = client.get("/api/v3/studies/does-not-exist")
        assert missing.status_code == 404
        assert missing.headers["content-type"].startswith("application/problem+json")
        assert missing.json()["code"] == "not_found"
        assert missing.headers["x-request-id"].startswith("req_")
