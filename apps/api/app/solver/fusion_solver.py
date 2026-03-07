from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import scipy.ndimage as ndi
import trimesh
from skimage import measure

from app.core.materials import MATERIALS
from app.solver.interfaces import NormalizedStudyInputV2, ProgressCallback, SolverOutcomeResult
from app.solver.normalization import DISTANCE_TO_M


@dataclass
class VariantParams:
    threshold: float
    smoothing_sigma: float
    rib_weight: float
    carve_bias: float
    anisotropy: float
    medial_weight: float
    void_bias: float


def _choose_pitch(mesh: trimesh.Trimesh) -> float:
    max_extent = float(np.max(mesh.extents))
    min_extent = float(np.min(mesh.extents))
    target_divisions = 74
    pitch = max_extent / target_divisions
    floor = min_extent / 140.0 if min_extent > 0 else pitch
    return float(np.clip(pitch, floor, max_extent / 36.0))


def _world_to_index(point: np.ndarray, transform: np.ndarray, shape: tuple[int, int, int]) -> tuple[int, int, int]:
    inv = np.linalg.inv(transform)
    hom = np.concatenate([point, np.array([1.0])])
    idxf = inv @ hom
    idx = np.round(idxf[:3]).astype(int)
    idx = np.clip(idx, [0, 0, 0], np.array(shape) - 1)
    return int(idx[0]), int(idx[1]), int(idx[2])


def _voxel_centers(shape: tuple[int, int, int], transform: np.ndarray) -> np.ndarray:
    coords = np.indices(shape, dtype=np.float32)
    flat = np.stack(
        [
            coords[0].ravel(),
            coords[1].ravel(),
            coords[2].ravel(),
            np.ones(np.prod(shape), dtype=np.float32),
        ],
        axis=1,
    )
    centers = (transform @ flat.T).T[:, :3]
    return centers.reshape(shape + (3,))


def _voxel_mask_from_centers(
    centers: np.ndarray,
    transform: np.ndarray,
    shape: tuple[int, int, int],
    solid_mask: np.ndarray,
    dilation: int,
) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for center in centers:
        x, y, z = _world_to_index(np.asarray(center, dtype=np.float64), transform, shape)
        mask[x, y, z] = True
    if dilation > 0:
        mask = ndi.binary_dilation(mask, iterations=dilation)
    return mask & solid_mask


def _force_seed_mask(
    forces: list[Any],
    transform: np.ndarray,
    shape: tuple[int, int, int],
    solid_mask: np.ndarray,
    pitch: float,
) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for force in forces:
        base = np.asarray(force.point_m, dtype=np.float64)
        direction = np.asarray(force.direction, dtype=np.float64)
        norm = np.linalg.norm(direction)
        if norm <= 1e-9:
            direction = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        else:
            direction = direction / norm

        radius = int(np.clip(np.sqrt(max(force.magnitude_n, 1.0)) / 40.0, 1, 2))
        trail_steps = radius + 1
        for step in range(trail_steps + 1):
            sample = base - direction * pitch * step
            x, y, z = _world_to_index(sample, transform, shape)
            mask[x, y, z] = True

    mask = ndi.binary_dilation(mask, iterations=1)
    return mask & solid_mask


def _rank_outcome(metrics: dict[str, float], target_safety_factor: float, target_mass_reduction_pct: float) -> float:
    safety_shortfall = max(0.0, target_safety_factor - metrics["safetyIndexProxy"])
    mass_gap = abs(target_mass_reduction_pct - metrics["massReductionPct"])
    return (
        metrics["complianceProxy"] * 0.55
        + metrics["stressProxy"] * 0.18
        + metrics["displacementProxy"] * 0.14
        + safety_shortfall * 28.0
        + mass_gap * 0.24
        - min(metrics["massReductionPct"], target_mass_reduction_pct) * 0.08
    )


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


def _variant_params(count: int, seed: int) -> list[VariantParams]:
    rng = np.random.default_rng(seed)
    span = max(count * 4, 14)
    thresholds = np.linspace(0.32, 0.64, num=span)
    sigmas = np.linspace(0.8, 2.4, num=span)
    rib_weights = np.linspace(0.12, 0.52, num=span)
    carve_biases = np.linspace(0.58, 0.9, num=span)
    anisotropies = np.linspace(0.8, 1.35, num=span)
    medial_weights = np.linspace(0.16, 0.38, num=span)
    void_biases = np.linspace(0.12, 0.62, num=span)

    params: list[VariantParams] = []
    for i in range(span):
        jitter = float(rng.uniform(-0.035, 0.035))
        params.append(
            VariantParams(
                threshold=float(np.clip(thresholds[i] + jitter, 0.28, 0.72)),
                smoothing_sigma=float(sigmas[::-1][i]),
                rib_weight=float(rib_weights[i]),
                carve_bias=float(carve_biases[::-1][i]),
                anisotropy=float(anisotropies[i]),
                medial_weight=float(medial_weights[::-1][i]),
                void_bias=float(void_biases[i]),
            )
        )
    return params


def _safe_volume(mesh: trimesh.Trimesh) -> float:
    volume = float(mesh.volume)
    if not np.isfinite(volume):
        return 0.0
    return abs(volume)


class FusionApproxSolver:
    solver_version = "opentos-v2.0.0-browser-parity"

    def solve(self, study: NormalizedStudyInputV2, progress: ProgressCallback) -> list[SolverOutcomeResult]:
        progress("parse", 0.04)

        mesh = study.mesh.copy()
        mesh.remove_duplicate_faces()
        mesh.remove_unreferenced_vertices()

        pitch = _choose_pitch(mesh)
        voxelized = mesh.voxelized(pitch).fill()
        occ = voxelized.matrix.astype(bool)
        transform = voxelized.transform.copy()

        if occ.sum() < 2000:
            raise RuntimeError("Design domain too small after voxelization; try a larger model or finer input mesh")

        progress("constraint-map", 0.1)

        preserved_centers = mesh.triangles_center[study.preserved_face_indices]
        preserved_occ = _voxel_mask_from_centers(preserved_centers, transform, occ.shape, occ, dilation=2)

        fixed_occ = np.zeros_like(occ, dtype=bool)
        all_forces = []
        total_force_n = 0.0
        for load_case in study.load_cases:
            all_forces.extend(load_case.forces)
            total_force_n += sum(force.magnitude_n for force in load_case.forces)
            fixed_centers = mesh.triangles_center[load_case.fixed_face_indices]
            fixed_occ |= _voxel_mask_from_centers(fixed_centers, transform, occ.shape, occ, dilation=1)

        obstacle_occ = np.zeros_like(occ, dtype=bool)
        if study.obstacle_face_indices.size > 0:
            obstacle_centers = mesh.triangles_center[study.obstacle_face_indices]
            obstacle_occ = _voxel_mask_from_centers(obstacle_centers, transform, occ.shape, occ, dilation=2)

        design_occ = np.zeros_like(occ, dtype=bool)
        if study.design_face_indices.size > 0:
            if study.design_face_indices.size >= mesh.faces.shape[0] * 0.6:
                design_occ = occ.copy()
            else:
                design_centers = mesh.triangles_center[study.design_face_indices]
                design_occ = _voxel_mask_from_centers(design_centers, transform, occ.shape, occ, dilation=4)
                design_occ = ndi.binary_closing(design_occ, iterations=2) & occ
        if not design_occ.any() or design_occ.sum() < occ.sum() * 0.12:
            design_occ = occ.copy()

        if preserved_occ.sum() == 0:
            raise RuntimeError("Preserved geometry could not be mapped into the design grid")

        force_seed = _force_seed_mask(all_forces, transform, occ.shape, occ, pitch)

        if force_seed.sum() == 0:
            raise RuntimeError("Force seeds could not be mapped into the design grid")

        design_domain = occ & design_occ & ~obstacle_occ
        if design_domain.sum() < 1500:
            raise RuntimeError("Obstacle constraints removed too much domain volume")

        progress("voxelize", 0.22)

        inside_dist = ndi.distance_transform_edt(design_domain)
        to_force = ndi.distance_transform_edt(~force_seed)
        to_preserved = ndi.distance_transform_edt(~(preserved_occ | fixed_occ))

        max_inside = float(max(inside_dist.max(), 1.0))
        boundary_support = inside_dist / max_inside
        pair_dist = to_force + to_preserved
        balance_dist = np.abs(to_force - to_preserved)
        connect_field = np.exp(-pair_dist / 8.6) * (0.58 + 0.42 * np.exp(-balance_dist / 4.8))

        centers = _voxel_centers(occ.shape, transform)
        directional = np.zeros_like(connect_field, dtype=np.float32)
        corridor = np.zeros_like(connect_field, dtype=np.float32)
        preserve_anchor_points = centers[preserved_occ | fixed_occ]
        preserve_centroid = preserve_anchor_points.mean(axis=0) if preserve_anchor_points.size else mesh.centroid
        for force in all_forces:
            vectors = centers - force.point_m
            norms = np.linalg.norm(vectors, axis=-1)
            safe_norms = np.maximum(norms, 1e-6)
            dirs = vectors / safe_norms[..., None]
            alignment = np.abs(np.sum(dirs * force.direction.reshape(1, 1, 1, 3), axis=-1))
            falloff = np.exp(-safe_norms / (pitch * 26.0))
            directional = np.maximum(directional, alignment * falloff)

            segment = preserve_centroid - force.point_m
            seg_len2 = max(float(np.dot(segment, segment)), 1e-9)
            rel = centers - force.point_m
            t = np.clip(np.sum(rel * segment.reshape(1, 1, 1, 3), axis=-1) / seg_len2, 0.0, 1.0)
            closest = force.point_m.reshape(1, 1, 1, 3) + t[..., None] * segment.reshape(1, 1, 1, 3)
            radial = np.linalg.norm(centers - closest, axis=-1)
            corridor = np.maximum(corridor, np.exp(-(radial**2) / (2.0 * max((pitch * 2.2) ** 2, 1e-9))))

        directional = (directional - directional.min()) / (directional.max() - directional.min() + 1e-9)
        medial = np.exp(-balance_dist / 3.6) * np.exp(-pair_dist / 11.0)
        medial = (medial - medial.min()) / (medial.max() - medial.min() + 1e-9)
        corridor = (corridor - corridor.min()) / (corridor.max() - corridor.min() + 1e-9)

        safety_weight = np.clip(study.target_safety_factor / 2.0, 0.8, 1.9)
        influence = (
            0.4 * connect_field
            + 0.22 * directional
            + 0.14 * boundary_support * safety_weight
            + 0.16 * medial
            + 0.18 * corridor
        )
        influence *= design_domain
        influence = ndi.gaussian_filter(influence.astype(np.float32), sigma=1.15)

        occ_vals = influence[design_domain]
        occ_vals = occ_vals[np.isfinite(occ_vals)]
        if occ_vals.size == 0:
            raise RuntimeError("Influence field collapsed; unable to synthesize variants")

        low_q = float(np.quantile(occ_vals, 0.31))
        high_q = float(np.quantile(occ_vals, 0.83))
        field_range = max(high_q - low_q, 1e-4)

        progress("fem-solve", 0.38)

        params = _variant_params(study.outcome_count, study.seed)

        unit_scale = DISTANCE_TO_M[study.units]
        inv_scale = 1.0 / unit_scale
        material = MATERIALS[study.material]

        preserved_exact = study.source_mesh.submesh([study.preserved_face_indices], append=True, repair=False)
        preserved_exact.remove_unreferenced_vertices()

        preserved_m = preserved_exact.copy()
        preserved_m.apply_scale(unit_scale)

        outcomes: list[SolverOutcomeResult] = []
        signatures: list[tuple[float, float, float]] = []
        anchor_mask = preserved_occ | fixed_occ | force_seed
        design_capacity = max(int((design_domain & ~(preserved_occ | fixed_occ)).sum()), 1)
        target_keep_fraction = float(np.clip(1.0 - study.target_mass_reduction_pct / 100.0, 0.08, 0.62))

        attempt_index = 0
        max_attempts = study.outcome_count * 7

        while len(outcomes) < study.outcome_count and attempt_index < max_attempts:
            p = params[attempt_index % len(params)]
            attempt_index += 1

            adaptive_threshold = low_q + p.threshold * field_range
            rib_boost = np.power(boundary_support, p.anisotropy) * p.rib_weight
            branch_boost = medial * p.medial_weight + corridor * (0.1 + p.medial_weight * 0.35)
            variant_field = influence + rib_boost + branch_boost

            core = design_domain & (variant_field >= adaptive_threshold)
            core |= anchor_mask

            core = _connected_keep(core, anchor_mask)

            wall_dist = ndi.distance_transform_edt(core)
            min_wall = np.clip(2.2 / max(pitch * 1000.0, 0.22), 1.0, 5.0)
            carve_limit = adaptive_threshold * max(0.35, p.carve_bias - p.void_bias * 0.18)
            carve = (wall_dist > min_wall) & (variant_field < carve_limit)
            core[carve] = False

            smoothed = ndi.gaussian_filter(core.astype(np.float32), sigma=p.smoothing_sigma)
            candidate = smoothed > 0.47
            candidate = ndi.binary_closing(candidate, iterations=1)
            candidate = ndi.binary_opening(candidate, iterations=1)
            candidate |= preserved_occ | fixed_occ
            candidate &= design_domain
            candidate = _connected_keep(candidate, anchor_mask)

            design_only = candidate & ~(preserved_occ | fixed_occ)
            if design_only.sum() < 500:
                continue

            desired_ratio = float(np.clip(target_keep_fraction + (p.threshold - 0.5) * 0.18, 0.08, 0.64))
            target_voxels = max(250, int(design_capacity * desired_ratio))
            if int(design_only.sum()) > target_voxels:
                active_values = variant_field[design_only]
                if active_values.size:
                    cutoff_q = float(np.clip(1.0 - target_voxels / max(active_values.size, 1), 0.0, 0.96))
                    cutoff = float(np.quantile(active_values, cutoff_q))
                    trimmed = candidate.copy()
                    trimmed[design_only & (variant_field < cutoff)] = False
                    trimmed |= preserved_occ | fixed_occ
                    trimmed &= design_domain
                    trimmed = ndi.binary_closing(trimmed, iterations=1)
                    trimmed = _connected_keep(trimmed, anchor_mask)
                    design_only = trimmed & ~(preserved_occ | fixed_occ)
                    candidate = trimmed
                    if design_only.sum() < 300:
                        continue

            try:
                volume_data = ndi.gaussian_filter(design_only.astype(np.float32), sigma=0.84)
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
            trimesh.smoothing.filter_taubin(generated_m, lamb=0.5, nu=-0.53, iterations=11)

            generated_src = generated_m.copy()
            generated_src.apply_scale(inv_scale)

            design_volume_m3 = _safe_volume(generated_m)
            preserved_volume_m3 = _safe_volume(preserved_m)
            total_volume_m3 = design_volume_m3 + preserved_volume_m3

            high_path = (variant_field > np.quantile(variant_field[candidate], 0.72)) & candidate
            effective_area_m2 = max(
                float(high_path.sum()) * pitch * pitch / max(mesh.extents.max() / pitch, 1.0),
                1e-6,
            )

            stress_proxy_mpa = (total_force_n / effective_area_m2) / 1e6
            char_length = float(np.linalg.norm(mesh.extents))
            elastic_pa = material.elastic_modulus_gpa * 1e9
            displacement_proxy_mm = (total_force_n * char_length / max(elastic_pa * effective_area_m2, 1e-6)) * 1000.0

            volume_display = total_volume_m3 / (unit_scale**3)
            mass_kg = total_volume_m3 * material.density_kg_m3
            baseline_volume = max(study.baseline_volume_display, 1e-9)
            mass_reduction_pct = np.clip((baseline_volume - volume_display) / baseline_volume * 100.0, -300, 99.9)
            safety_index_proxy = material.yield_strength_mpa / max(stress_proxy_mpa, 1e-6)
            compliance_proxy = displacement_proxy_mm * (total_force_n / 1000.0 + 1.0)

            signature = (round(volume_display, 4), round(stress_proxy_mpa, 4), round(displacement_proxy_mm, 4))
            duplicate = any(
                abs(signature[0] - s[0]) < 0.02 * max(signature[0], 1e-6)
                and abs(signature[1] - s[1]) < 0.03 * max(signature[1], 1e-6)
                and abs(signature[2] - s[2]) < 0.03 * max(signature[2], 1e-6)
                for s in signatures
            )
            if duplicate:
                continue
            signatures.append(signature)

            scene = trimesh.Scene()
            scene.add_geometry(preserved_exact, node_name="preserved")
            scene.add_geometry(generated_src, node_name="generated")
            glb_bytes = scene.export(file_type="glb")

            outcome_id = f"OUT-{len(outcomes) + 1:02d}"
            metrics = {
                "baselineVolume": float(baseline_volume),
                "volume": float(volume_display),
                "mass": float(mass_kg),
                "massReductionPct": float(mass_reduction_pct),
                "stressProxy": float(stress_proxy_mpa),
                "displacementProxy": float(displacement_proxy_mm),
                "safetyIndexProxy": float(safety_index_proxy),
                "complianceProxy": float(compliance_proxy),
            }
            outcomes.append(
                SolverOutcomeResult(
                    id=outcome_id,
                    glb_bytes=glb_bytes,
                    metrics=metrics,
                    params={
                        "threshold": p.threshold,
                        "smoothingSigma": p.smoothing_sigma,
                        "ribWeight": p.rib_weight,
                        "carveBias": p.carve_bias,
                        "anisotropy": p.anisotropy,
                        "medialWeight": p.medial_weight,
                        "voidBias": p.void_bias,
                        "pitch": pitch,
                        "rankScore": _rank_outcome(
                            metrics,
                            study.target_safety_factor,
                            study.target_mass_reduction_pct,
                        ),
                    },
                )
            )

            progress("topology-opt", 0.4 + 0.42 * (len(outcomes) / max(study.outcome_count, 1)))

        if not outcomes:
            raise RuntimeError("Unable to generate any valid design outcomes from the provided setup")

        if len(outcomes) < study.outcome_count:
            for idx in range(len(outcomes)):
                outcomes[idx].params["uniquenessFallback"] = True

        outcomes.sort(
            key=lambda outcome: _rank_outcome(
                outcome.metrics,
                study.target_safety_factor,
                study.target_mass_reduction_pct,
            )
        )
        for idx, outcome in enumerate(outcomes, start=1):
            outcome.id = f"OUT-{idx:02d}"
            outcome.params["rankScore"] = _rank_outcome(
                outcome.metrics,
                study.target_safety_factor,
                study.target_mass_reduction_pct,
            )

        progress("reconstruct", 0.9)
        progress("rank-export", 0.96)
        return outcomes
