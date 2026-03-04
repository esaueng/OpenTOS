from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import scipy.ndimage as ndi
import trimesh
from skimage import measure

from app.core.materials import MATERIALS
from app.solver.interfaces import NormalizedStudyInput, ProgressCallback, SolverOutcomeResult
from app.solver.normalization import DISTANCE_TO_M


@dataclass
class VariantParams:
    threshold: float
    smoothing_sigma: float
    rib_weight: float
    carve_bias: float


def _choose_pitch(mesh: trimesh.Trimesh) -> float:
    max_extent = float(np.max(mesh.extents))
    min_extent = float(np.min(mesh.extents))
    target_divisions = 72
    pitch = max_extent / target_divisions
    floor = min_extent / 140.0 if min_extent > 0 else pitch
    return float(np.clip(pitch, floor, max_extent / 40.0))


def _world_to_index(point: np.ndarray, transform: np.ndarray, shape: tuple[int, int, int]) -> tuple[int, int, int]:
    inv = np.linalg.inv(transform)
    hom = np.concatenate([point, np.array([1.0])])
    idxf = inv @ hom
    idx = np.round(idxf[:3]).astype(int)
    idx = np.clip(idx, [0, 0, 0], np.array(shape) - 1)
    return int(idx[0]), int(idx[1]), int(idx[2])


def _voxel_centers(shape: tuple[int, int, int], transform: np.ndarray) -> np.ndarray:
    coords = np.indices(shape, dtype=np.float32)
    flat = np.stack([coords[0].ravel(), coords[1].ravel(), coords[2].ravel(), np.ones(np.prod(shape), dtype=np.float32)], axis=1)
    centers = (transform @ flat.T).T[:, :3]
    return centers.reshape(shape + (3,))


def _connected_keep(mask: np.ndarray, anchor: np.ndarray) -> np.ndarray:
    labels, n = ndi.label(mask)
    if n == 0:
        return mask

    anchor_labels = np.unique(labels[anchor & (labels > 0)])
    if anchor_labels.size == 0:
        largest = np.argmax(np.bincount(labels.ravel())[1:]) + 1
        return labels == largest

    keep = np.isin(labels, anchor_labels)
    return keep


def _variant_params(count: int) -> list[VariantParams]:
    thresholds = np.linspace(0.42, 0.62, num=count * 2)
    sigmas = np.linspace(0.9, 2.2, num=count * 2)
    rib_weights = np.linspace(0.12, 0.42, num=count * 2)
    carve_biases = np.linspace(0.72, 0.9, num=count * 2)

    params: list[VariantParams] = []
    for i in range(count * 2):
        params.append(
            VariantParams(
                threshold=float(thresholds[i]),
                smoothing_sigma=float(sigmas[::-1][i]),
                rib_weight=float(rib_weights[i]),
                carve_bias=float(carve_biases[::-1][i]),
            )
        )
    return params


def _safe_volume(mesh: trimesh.Trimesh) -> float:
    volume = float(mesh.volume)
    if not np.isfinite(volume):
        return 0.0
    return abs(volume)


class FusionApproxSolver:
    def solve(self, study: NormalizedStudyInput, progress: ProgressCallback) -> list[SolverOutcomeResult]:
        progress("parse", 0.06)

        mesh = study.mesh.copy()
        mesh.remove_duplicate_faces()
        mesh.remove_unreferenced_vertices()

        pitch = _choose_pitch(mesh)
        voxelized = mesh.voxelized(pitch).fill()
        occ = voxelized.matrix.astype(bool)
        transform = voxelized.transform.copy()

        if occ.sum() < 2000:
            raise RuntimeError("Design domain too small after voxelization; try a larger model or finer input mesh")

        progress("voxelize", 0.22)

        preserved_occ = np.zeros_like(occ, dtype=bool)
        preserved_centers = mesh.triangles_center[study.preserved_face_indices]
        for center in preserved_centers:
            x, y, z = _world_to_index(center, transform, occ.shape)
            preserved_occ[x, y, z] = True
        preserved_occ = ndi.binary_dilation(preserved_occ, iterations=2)
        preserved_occ &= occ

        if preserved_occ.sum() == 0:
            raise RuntimeError("Preserved geometry could not be mapped into the design grid")

        force_seed = np.zeros_like(occ, dtype=bool)
        for force in study.forces:
            x, y, z = _world_to_index(force.point_m, transform, occ.shape)
            force_seed[x, y, z] = True
        force_seed = ndi.binary_dilation(force_seed, iterations=2)

        inside_dist = ndi.distance_transform_edt(occ)
        to_force = ndi.distance_transform_edt(~force_seed)
        to_preserved = ndi.distance_transform_edt(~preserved_occ)

        max_inside = float(max(inside_dist.max(), 1.0))
        boundary_support = inside_dist / max_inside

        connect_field = np.exp(-to_force / 8.0) * np.exp(-to_preserved / 9.0)

        centers = _voxel_centers(occ.shape, transform)
        directional = np.zeros_like(connect_field, dtype=np.float32)
        for force in study.forces:
            vectors = centers - force.point_m
            norms = np.linalg.norm(vectors, axis=-1)
            safe_norms = np.maximum(norms, 1e-6)
            dirs = vectors / safe_norms[..., None]
            alignment = np.abs(np.sum(dirs * force.direction.reshape(1, 1, 1, 3), axis=-1))
            falloff = np.exp(-safe_norms / (pitch * 28.0))
            directional = np.maximum(directional, alignment * falloff)

        directional = (directional - directional.min()) / (directional.max() - directional.min() + 1e-9)

        safety_weight = np.clip(study.target_safety_factor / 2.0, 0.8, 1.8)
        influence = (
            0.55 * connect_field + 0.25 * directional + 0.20 * boundary_support * safety_weight
        )
        influence *= occ
        influence = ndi.gaussian_filter(influence.astype(np.float32), sigma=1.2)

        occ_vals = influence[occ]
        occ_vals = occ_vals[np.isfinite(occ_vals)]
        if occ_vals.size == 0:
            raise RuntimeError("Influence field collapsed; unable to synthesize variants")

        low_q = float(np.quantile(occ_vals, 0.34))
        high_q = float(np.quantile(occ_vals, 0.78))
        field_range = max(high_q - low_q, 1e-4)

        params = _variant_params(study.outcome_count)
        progress("field-solve", 0.45)

        unit_scale = DISTANCE_TO_M[study.units]
        inv_scale = 1.0 / unit_scale
        material = MATERIALS[study.material]

        preserved_exact = study.source_mesh.submesh([study.preserved_face_indices], append=True, repair=False)
        preserved_exact.remove_unreferenced_vertices()

        preserved_m = preserved_exact.copy()
        preserved_m.apply_scale(unit_scale)

        outcomes: list[SolverOutcomeResult] = []
        signatures: list[tuple[float, float]] = []
        anchor_mask = preserved_occ | force_seed

        attempt_index = 0
        max_attempts = study.outcome_count * 5

        while len(outcomes) < study.outcome_count and attempt_index < max_attempts:
            p = params[attempt_index % len(params)]
            attempt_index += 1

            normalized_threshold = low_q + p.threshold * field_range
            rib_boost = boundary_support * p.rib_weight
            variant_field = influence + rib_boost

            core = occ & (variant_field >= normalized_threshold)
            core |= anchor_mask

            core = _connected_keep(core, anchor_mask)

            wall_dist = ndi.distance_transform_edt(core)
            min_wall = np.clip(2.5 / max(pitch * 1000.0, 0.25), 1.0, 5.0)
            carve = (wall_dist > min_wall) & (variant_field < normalized_threshold * p.carve_bias)
            core[carve] = False

            smoothed = ndi.gaussian_filter(core.astype(np.float32), sigma=p.smoothing_sigma)
            candidate = smoothed > 0.46
            candidate = ndi.binary_closing(candidate, iterations=1)
            candidate = ndi.binary_opening(candidate, iterations=1)
            candidate |= preserved_occ
            candidate &= occ
            candidate = _connected_keep(candidate, anchor_mask)

            design_only = candidate & ~preserved_occ
            if design_only.sum() < 500:
                continue

            try:
                volume_data = ndi.gaussian_filter(design_only.astype(np.float32), sigma=0.85)
                verts, faces, _normals, _values = measure.marching_cubes(volume_data, level=0.5, spacing=(1.0, 1.0, 1.0))
            except ValueError:
                continue

            verts_h = np.c_[verts, np.ones((verts.shape[0], 1), dtype=np.float32)]
            verts_world = (transform @ verts_h.T).T[:, :3]

            generated_m = trimesh.Trimesh(vertices=verts_world, faces=faces.astype(np.int64), process=False)
            if generated_m.faces.shape[0] < 200:
                continue

            generated_m.remove_degenerate_faces()
            generated_m.remove_duplicate_faces()
            generated_m.remove_unreferenced_vertices()
            trimesh.smoothing.filter_taubin(generated_m, lamb=0.5, nu=-0.53, iterations=10)

            generated_src = generated_m.copy()
            generated_src.apply_scale(inv_scale)

            design_volume_m3 = _safe_volume(generated_m)
            preserved_volume_m3 = _safe_volume(preserved_m)
            total_volume_m3 = design_volume_m3 + preserved_volume_m3

            total_force_n = sum(force.magnitude_n for force in study.forces)
            high_path = (variant_field > np.quantile(variant_field[candidate], 0.72)) & candidate
            effective_area_m2 = max(float(high_path.sum()) * pitch * pitch / max(mesh.extents.max() / pitch, 1.0), 1e-6)

            stress_proxy_mpa = (total_force_n / effective_area_m2) / 1e6
            char_length = float(np.linalg.norm(mesh.extents))
            elastic_pa = material.elastic_modulus_gpa * 1e9
            displacement_proxy_mm = (total_force_n * char_length / max(elastic_pa * effective_area_m2, 1e-6)) * 1000.0

            volume_display = total_volume_m3 / (unit_scale ** 3)
            mass_kg = total_volume_m3 * material.density_kg_m3

            signature = (round(volume_display, 4), round(stress_proxy_mpa, 4))
            if any(abs(signature[0] - s[0]) < 0.02 * max(signature[0], 1e-6) and abs(signature[1] - s[1]) < 0.03 * max(signature[1], 1e-6) for s in signatures):
                continue

            signatures.append(signature)

            scene = trimesh.Scene()
            scene.add_geometry(preserved_exact, node_name="preserved")
            scene.add_geometry(generated_src, node_name="generated")
            glb_bytes = scene.export(file_type="glb")

            outcome_id = f"OUT-{len(outcomes) + 1:02d}"
            outcomes.append(
                SolverOutcomeResult(
                    id=outcome_id,
                    glb_bytes=glb_bytes,
                    metrics={
                        "volume": float(volume_display),
                        "mass": float(mass_kg),
                        "stressProxy": float(stress_proxy_mpa),
                        "displacementProxy": float(displacement_proxy_mm),
                    },
                    params={
                        "threshold": p.threshold,
                        "smoothingSigma": p.smoothing_sigma,
                        "ribWeight": p.rib_weight,
                        "carveBias": p.carve_bias,
                        "pitch": pitch,
                    },
                )
            )

            progress("variant-synth", 0.45 + 0.45 * (len(outcomes) / max(study.outcome_count, 1)))

        if not outcomes:
            raise RuntimeError("Unable to generate any valid design outcomes from the provided setup")

        if len(outcomes) < study.outcome_count:
            # Keep deterministic behavior while signaling fallback in params.
            for idx in range(len(outcomes)):
                outcomes[idx].params["uniquenessFallback"] = True

        progress("export", 0.95)
        return outcomes
