from __future__ import annotations

import base64

from app.models.contracts import RunOptions, StudyCreateRequest
from app.solver.normalization import DISTANCE_TO_M, FORCE_TO_N, normalize_study


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


def test_normalization_converts_units_forces_and_constraints() -> None:
    req = StudyCreateRequest(
        model={"format": "obj", "dataBase64": _sample_obj_b64()},
        units="mm",
        designRegion={"faceIndices": [0, 1, 2, 3]},
        preservedRegions=[{"id": "mountA", "faceIndices": [0]}],
        obstacleRegions=[{"id": "keepout", "faceIndices": [2]}],
        loadCases=[
            {
                "id": "LC-1",
                "fixedRegions": ["mountA"],
                "forces": [{"point": [0, 0, 0], "direction": [0, 0, -1], "magnitude": 10, "unit": "lb"}],
            }
        ],
        material="Aluminum 6061",
        targets={"safetyFactor": 2.0, "outcomeCount": 4, "massReductionGoalPct": 45.0},
    )

    out = normalize_study(req, RunOptions(qualityProfile="balanced"))
    assert out.mesh.faces.shape[0] == 4
    assert out.preserved_face_indices.tolist() == [0]
    assert out.obstacle_face_indices.tolist() == [2]
    assert out.design_face_indices.tolist() == [1, 3]
    assert len(out.load_cases) == 1
    assert abs(out.load_cases[0].forces[0].magnitude_n - 10 * FORCE_TO_N["lb"]) < 1e-8
    assert abs(out.mesh.extents.max() - 10 * DISTANCE_TO_M["mm"]) < 1e-6
