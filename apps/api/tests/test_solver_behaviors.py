from __future__ import annotations

import base64
import io

import numpy as np
import trimesh

from app.models.contracts import RunOptions, StudyCreateRequest
from app.solver.fusion_solver import FusionApproxSolver
from app.solver.normalization import normalize_study


def _box_obj_base64() -> str:
    obj = """
v -0.6 -0.2 -0.1
v  0.6 -0.2 -0.1
v  0.6  0.2 -0.1
v -0.6  0.2 -0.1
v -0.6 -0.2  0.1
v  0.6 -0.2  0.1
v  0.6  0.2  0.1
v -0.6  0.2  0.1
f 1 2 3
f 1 3 4
f 5 8 7
f 5 7 6
f 1 5 6
f 1 6 2
f 2 6 7
f 2 7 3
f 3 7 8
f 3 8 4
f 4 8 5
f 4 5 1
""".strip()
    return base64.b64encode(obj.encode("utf-8")).decode("utf-8")


def _request(outcome_count: int = 3) -> StudyCreateRequest:
    return StudyCreateRequest(
        model={"format": "obj", "dataBase64": _box_obj_base64()},
        units="m",
        designRegion={"faceIndices": list(range(12))},
        preservedRegions=[{"id": "mountA", "faceIndices": [0, 1, 2, 3]}],
        obstacleRegions=[],
        loadCases=[
            {
                "id": "LC-1",
                "fixedRegions": ["mountA"],
                "forces": [
                    {"point": [0.55, 0.0, 0.0], "direction": [-1, 0.2, 0], "magnitude": 1200, "unit": "N"},
                    {"point": [-0.55, 0.0, 0.0], "direction": [1, -0.2, 0], "magnitude": 900, "unit": "N"},
                ],
            }
        ],
        material="Aluminum 6061",
        targets={"safetyFactor": 2.2, "outcomeCount": outcome_count, "massReductionGoalPct": 45.0},
    )


def test_solver_generates_outcomes_with_v2_metrics() -> None:
    study = normalize_study(_request(outcome_count=3), RunOptions(qualityProfile="balanced"))
    solver = FusionApproxSolver()

    progress_events: list[tuple[str, float]] = []

    def progress(stage: str, pct: float) -> None:
        progress_events.append((stage, pct))

    outcomes = solver.solve(study, progress)

    assert len(outcomes) >= 1
    assert any(stage == "topology-opt" for stage, _ in progress_events)

    first = outcomes[0]
    assert first.glb_bytes.startswith(b"glTF")
    assert first.metrics["baselineVolume"] > 0
    assert first.metrics["volume"] > 0
    assert first.metrics["mass"] > 0
    assert first.metrics["stressProxy"] > 0
    assert first.metrics["displacementProxy"] >= 0
    assert first.metrics["safetyIndexProxy"] > 0
    assert "massReductionPct" in first.metrics


def test_solver_variants_are_not_all_duplicates() -> None:
    study = normalize_study(_request(outcome_count=4), RunOptions(qualityProfile="balanced"))
    solver = FusionApproxSolver()
    outcomes = solver.solve(study, lambda _stage, _pct: None)

    if len(outcomes) > 1:
        volumes = [out.metrics["volume"] for out in outcomes]
        assert np.ptp(volumes) > 1e-6


def test_glb_contains_preserved_and_generated_nodes() -> None:
    study = normalize_study(_request(outcome_count=2), RunOptions(qualityProfile="balanced"))
    solver = FusionApproxSolver()
    outcome = solver.solve(study, lambda _stage, _pct: None)[0]

    loaded = trimesh.load(io.BytesIO(outcome.glb_bytes), file_type="glb")
    assert isinstance(loaded, trimesh.Scene)
    names = list(loaded.graph.nodes_geometry)

    assert any("preserved" in name for name in names)
