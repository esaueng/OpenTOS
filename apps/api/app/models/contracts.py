from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EncodedModel(BaseModel):
    format: Literal["stl", "obj", "glb"]
    dataBase64: str = Field(min_length=1)


class PreservedRegion(BaseModel):
    id: str = Field(min_length=1)
    faceIndices: list[int] = Field(min_length=1)

    @field_validator("faceIndices")
    @classmethod
    def unique_indices(cls, value: list[int]) -> list[int]:
        deduped = sorted(set(value))
        if deduped != value:
            return deduped
        return value


class ForceDef(BaseModel):
    point: tuple[float, float, float]
    direction: tuple[float, float, float]
    magnitude: float = Field(gt=0)
    unit: Literal["N", "lb"]
    label: Optional[str] = None


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: EncodedModel
    units: Literal["mm", "in", "m"]
    preservedRegions: list[PreservedRegion] = Field(min_length=1)
    forces: list[ForceDef] = Field(min_length=1)
    material: Literal["Aluminum 6061"]
    targetSafetyFactor: float = Field(ge=1.0)
    outcomeCount: int = Field(ge=2, le=12)
    manufacturingConstraint: Optional[Literal["3-axis milling", "Additive"]] = None


class OutcomeMetrics(BaseModel):
    volume: float
    mass: float
    stressProxy: float
    displacementProxy: float


class Outcome(BaseModel):
    id: str
    optimizedModel: EncodedModel
    metrics: OutcomeMetrics


class SolveResponse(BaseModel):
    outcomes: list[Outcome]


class SolveAcceptedResponse(BaseModel):
    jobId: str
    statusUrl: str


class JobState(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


class JobStage(str, Enum):
    queued = "queued"
    parse = "parse"
    voxelize = "voxelize"
    field_solve = "field-solve"
    variant_synth = "variant-synth"
    export = "export"
    complete = "complete"
    failed = "failed"


class JobStatusResponse(BaseModel):
    jobId: str
    status: JobState
    stage: JobStage
    progress: float = Field(ge=0.0, le=1.0)
    error: Optional[str] = None
    outcomes: Optional[list[Outcome]] = None


class MaterialDef(BaseModel):
    id: str
    name: str
    densityKgM3: float
    elasticModulusGPa: float
    yieldStrengthMPa: float
    default: bool


class MaterialsResponse(BaseModel):
    materials: list[MaterialDef]
