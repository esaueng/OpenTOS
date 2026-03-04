from __future__ import annotations

import io

import numpy as np
import trimesh
from fastapi import HTTPException

from app.models.contracts import SolveRequest
from app.solver.interfaces import NormalizedForce, NormalizedStudyInput
from app.utils.encoding import b64_to_bytes


DISTANCE_TO_M = {"mm": 0.001, "in": 0.0254, "m": 1.0}
FORCE_TO_N = {"N": 1.0, "lb": 4.4482216152605}


def _to_mesh(payload: bytes, model_format: str) -> trimesh.Trimesh:
    loaded = trimesh.load(io.BytesIO(payload), file_type=model_format)

    if isinstance(loaded, trimesh.Scene):
        geom = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not geom:
            raise HTTPException(status_code=400, detail="Uploaded model did not contain mesh geometry")
        return trimesh.util.concatenate(geom)

    if not isinstance(loaded, trimesh.Trimesh):
        raise HTTPException(status_code=400, detail="Uploaded model is not a supported mesh")

    return loaded


def normalize_request(request: SolveRequest) -> NormalizedStudyInput:
    raw_model = b64_to_bytes(request.model.dataBase64)
    source_mesh = _to_mesh(raw_model, request.model.format)
    source_mesh.remove_unreferenced_vertices()

    if source_mesh.faces.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Uploaded mesh has no faces")

    unit_scale = DISTANCE_TO_M[request.units]
    mesh = source_mesh.copy()
    mesh.apply_scale(unit_scale)

    face_count = mesh.faces.shape[0]
    preserved_set: set[int] = set()
    for region in request.preservedRegions:
        for face_index in region.faceIndices:
            if face_index < 0 or face_index >= face_count:
                raise HTTPException(
                    status_code=400,
                    detail=f"Preserved face index {face_index} out of range for mesh with {face_count} faces",
                )
            preserved_set.add(face_index)

    if not preserved_set:
        raise HTTPException(status_code=400, detail="At least one preserved face is required")

    preserved_face_indices = np.array(sorted(preserved_set), dtype=np.int32)
    all_indices = np.arange(face_count, dtype=np.int32)
    design_face_indices = np.setdiff1d(all_indices, preserved_face_indices)

    if design_face_indices.size == 0:
        raise HTTPException(status_code=400, detail="Design space is empty after preserved-region selection")

    normalized_forces: list[NormalizedForce] = []
    for idx, force in enumerate(request.forces):
        direction = np.asarray(force.direction, dtype=np.float64)
        norm = np.linalg.norm(direction)
        if norm <= 1e-9:
            raise HTTPException(status_code=400, detail=f"Force #{idx + 1} has zero-length direction")

        normalized_forces.append(
            NormalizedForce(
                point_m=np.asarray(force.point, dtype=np.float64) * unit_scale,
                direction=direction / norm,
                magnitude_n=force.magnitude * FORCE_TO_N[force.unit],
                label=force.label or f"F{idx + 1}",
            )
        )

    return NormalizedStudyInput(
        mesh=mesh,
        source_mesh=source_mesh,
        units=request.units,
        preserved_face_indices=preserved_face_indices,
        design_face_indices=design_face_indices,
        forces=normalized_forces,
        material=request.material,
        target_safety_factor=request.targetSafetyFactor,
        outcome_count=request.outcomeCount,
        manufacturing_constraint=request.manufacturingConstraint,
    )
