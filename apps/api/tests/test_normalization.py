from __future__ import annotations

import base64

from app.models.contracts import SolveRequest
from app.solver.normalization import FORCE_TO_N, DISTANCE_TO_M, normalize_request


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


def test_normalization_converts_units_and_forces() -> None:
    req = SolveRequest(
        model={"format": "obj", "dataBase64": _sample_obj_b64()},
        units="mm",
        preservedRegions=[{"id": "p1", "faceIndices": [0]}],
        forces=[{"point": [0, 0, 0], "direction": [0, 0, -1], "magnitude": 10, "unit": "lb"}],
        material="Aluminum 6061",
        targetSafetyFactor=2.0,
        outcomeCount=4,
    )

    out = normalize_request(req)
    assert out.mesh.faces.shape[0] == 4
    assert out.preserved_face_indices.tolist() == [0]
    assert out.design_face_indices.tolist() == [1, 2, 3]
    assert abs(out.forces[0].magnitude_n - 10 * FORCE_TO_N["lb"]) < 1e-8
    assert abs(out.mesh.extents.max() - 10 * DISTANCE_TO_M["mm"]) < 1e-6
