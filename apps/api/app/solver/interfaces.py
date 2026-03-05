from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

import numpy as np
import trimesh


@dataclass
class NormalizedForce:
    point_m: np.ndarray
    direction: np.ndarray
    magnitude_n: float
    label: str


@dataclass
class NormalizedLoadCase:
    id: str
    fixed_face_indices: np.ndarray
    forces: list[NormalizedForce]


@dataclass
class NormalizedStudyInputV2:
    mesh: trimesh.Trimesh
    source_mesh: trimesh.Trimesh
    units: str
    preserved_face_indices: np.ndarray
    design_face_indices: np.ndarray
    obstacle_face_indices: np.ndarray
    load_cases: list[NormalizedLoadCase]
    material: str
    target_safety_factor: float
    target_mass_reduction_pct: float
    outcome_count: int
    quality_profile: str
    seed: int
    baseline_volume_display: float


@dataclass
class SolverOutcomeResult:
    id: str
    glb_bytes: bytes
    metrics: dict[str, float]
    params: dict[str, Any]


ProgressCallback = Callable[[str, float], None]


class SolverAdapter(Protocol):
    def solve(self, study: NormalizedStudyInputV2, progress: ProgressCallback) -> list[SolverOutcomeResult]:
        ...
