from __future__ import annotations

import io

import numpy as np
import trimesh
from fastapi import HTTPException

from app.models.contracts import RunOptions, StudyCreateRequest
from app.solver.interfaces import NormalizedForce, NormalizedLoadCase, NormalizedStudyInputV2
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


def _validate_face_indices(indices: list[int], face_count: int, label: str) -> np.ndarray:
    for idx in indices:
        if idx < 0 or idx >= face_count:
            raise HTTPException(
                status_code=400,
                detail=f"{label} face index {idx} out of range for mesh with {face_count} faces",
            )
    return np.array(sorted(set(indices)), dtype=np.int32)


def normalize_study(request: StudyCreateRequest, run_options: RunOptions) -> NormalizedStudyInputV2:
    raw_model = b64_to_bytes(request.model.dataBase64)
    source_mesh = _to_mesh(raw_model, request.model.format)
    source_mesh.remove_unreferenced_vertices()

    if source_mesh.faces.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Uploaded mesh has no faces")

    unit_scale = DISTANCE_TO_M[request.units]
    mesh = source_mesh.copy()
    mesh.apply_scale(unit_scale)

    face_count = mesh.faces.shape[0]
    design_face_indices = _validate_face_indices(request.designRegion.faceIndices, face_count, "Design")
    preserved_region_map: dict[str, np.ndarray] = {}

    preserved_all: set[int] = set()
    for region in request.preservedRegions:
        region_indices = _validate_face_indices(region.faceIndices, face_count, "Preserved")
        if region_indices.size == 0:
            continue
        preserved_region_map[region.id] = region_indices
        preserved_all.update(region_indices.tolist())

    if not preserved_all:
        raise HTTPException(status_code=400, detail="At least one preserved region is required")
    preserved_face_indices = np.array(sorted(preserved_all), dtype=np.int32)

    obstacle_all: set[int] = set()
    for region in request.obstacleRegions:
        region_indices = _validate_face_indices(region.faceIndices, face_count, "Obstacle")
        obstacle_all.update(region_indices.tolist())
    obstacle_face_indices = np.array(sorted(obstacle_all), dtype=np.int32)

    design_filtered = np.array(
        sorted(set(design_face_indices.tolist()) - set(preserved_face_indices.tolist()) - set(obstacle_face_indices.tolist())),
        dtype=np.int32,
    )
    if design_filtered.size == 0:
        raise HTTPException(status_code=400, detail="Design region becomes empty after constraints are applied")

    normalized_load_cases: list[NormalizedLoadCase] = []
    total_force_count = 0
    for lc in request.loadCases:
        fixed_indices: set[int] = set()
        for region_id in lc.fixedRegions:
            if region_id not in preserved_region_map:
                raise HTTPException(
                    status_code=400,
                    detail=f"Load case '{lc.id}' references unknown fixed region '{region_id}'",
                )
            fixed_indices.update(preserved_region_map[region_id].tolist())

        if not fixed_indices:
            raise HTTPException(
                status_code=400,
                detail=f"Load case '{lc.id}' has no valid fixed region faces",
            )

        normalized_forces: list[NormalizedForce] = []
        for idx, force in enumerate(lc.forces):
            direction = np.asarray(force.direction, dtype=np.float64)
            norm = np.linalg.norm(direction)
            if norm <= 1e-9:
                raise HTTPException(status_code=400, detail=f"Load case '{lc.id}' force #{idx + 1} has zero-length direction")
            normalized_forces.append(
                NormalizedForce(
                    point_m=np.asarray(force.point, dtype=np.float64) * unit_scale,
                    direction=direction / norm,
                    magnitude_n=force.magnitude * FORCE_TO_N[force.unit],
                    label=force.label or f"{lc.id}-F{idx + 1}",
                )
            )
        total_force_count += len(normalized_forces)
        normalized_load_cases.append(
            NormalizedLoadCase(
                id=lc.id,
                fixed_face_indices=np.array(sorted(fixed_indices), dtype=np.int32),
                forces=normalized_forces,
            )
        )

    if total_force_count == 0:
        raise HTTPException(status_code=400, detail="At least one force is required across load cases")

    baseline_volume_m3 = abs(float(mesh.volume))
    baseline_volume_display = baseline_volume_m3 / (unit_scale**3)

    outcome_count = run_options.outcomeCountOverride or request.targets.outcomeCount
    seed = run_options.seed if run_options.seed is not None else 0

    return NormalizedStudyInputV2(
        mesh=mesh,
        source_mesh=source_mesh,
        units=request.units,
        preserved_face_indices=preserved_face_indices,
        design_face_indices=design_filtered,
        obstacle_face_indices=obstacle_face_indices,
        load_cases=normalized_load_cases,
        material=request.material,
        target_safety_factor=request.targets.safetyFactor,
        target_mass_reduction_pct=request.targets.massReductionGoalPct,
        outcome_count=outcome_count,
        quality_profile=run_options.qualityProfile,
        seed=seed,
        baseline_volume_display=baseline_volume_display,
    )
