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

PLA = Material(
    id="pla",
    name="PLA",
    density_kg_m3=1240.0,
    elastic_modulus_gpa=3.5,
    yield_strength_mpa=60.0,
)

PETG = Material(
    id="petg",
    name="PETG",
    density_kg_m3=1270.0,
    elastic_modulus_gpa=2.1,
    yield_strength_mpa=50.0,
)

ABS = Material(
    id="abs",
    name="ABS",
    density_kg_m3=1040.0,
    elastic_modulus_gpa=2.1,
    yield_strength_mpa=40.0,
)

ASA = Material(
    id="asa",
    name="ASA",
    density_kg_m3=1070.0,
    elastic_modulus_gpa=2.0,
    yield_strength_mpa=42.0,
)

NYLON_PA12 = Material(
    id="nylon-pa12",
    name="Nylon (PA12)",
    density_kg_m3=1010.0,
    elastic_modulus_gpa=1.7,
    yield_strength_mpa=45.0,
)

POLYCARBONATE_PC = Material(
    id="pc",
    name="Polycarbonate (PC)",
    density_kg_m3=1200.0,
    elastic_modulus_gpa=2.3,
    yield_strength_mpa=65.0,
)

MATERIALS = {
    material.name: material
    for material in (
        ALUMINUM_6061,
        PLA,
        PETG,
        ABS,
        ASA,
        NYLON_PA12,
        POLYCARBONATE_PC,
    )
}
