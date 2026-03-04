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
class NormalizedStudyInput:
    mesh: trimesh.Trimesh
    source_mesh: trimesh.Trimesh
    units: str
    preserved_face_indices: np.ndarray
    design_face_indices: np.ndarray
    forces: list[NormalizedForce]
    material: str
    target_safety_factor: float
    outcome_count: int
    manufacturing_constraint: str | None


@dataclass
class SolverOutcomeResult:
    id: str
    glb_bytes: bytes
    metrics: dict[str, float]
    params: dict[str, Any]


ProgressCallback = Callable[[str, float], None]


class SolverAdapter(Protocol):
    def solve(self, study: NormalizedStudyInput, progress: ProgressCallback) -> list[SolverOutcomeResult]:
        ...
