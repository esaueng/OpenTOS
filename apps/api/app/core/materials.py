from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    id: str
    name: str
    density_kg_m3: float
    elastic_modulus_gpa: float
    yield_strength_mpa: float
    default: bool = False


ALUMINUM_6061 = Material(
    id="al-6061",
    name="Aluminum 6061",
    density_kg_m3=2700.0,
    elastic_modulus_gpa=69.0,
    yield_strength_mpa=276.0,
    default=True,
)

MATERIALS = {ALUMINUM_6061.name: ALUMINUM_6061}
