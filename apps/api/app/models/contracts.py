from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

MATERIAL_NAMES = (
    "Aluminum 6061",
    "PLA",
    "PETG",
    "ABS",
    "ASA",
    "Nylon (PA12)",
    "Polycarbonate (PC)",
)


class EncodedModel(BaseModel):
    format: Literal["stl", "obj", "glb"]
    dataBase64: str = Field(min_length=1)


class FaceRegion(BaseModel):
    id: str = Field(min_length=1)
    faceIndices: list[int] = Field(min_length=1)

    @field_validator("faceIndices")
    @classmethod
    def dedupe_sorted(cls, value: list[int]) -> list[int]:
        deduped = sorted(set(value))
        return deduped


class DesignRegion(BaseModel):
    faceIndices: list[int] = Field(min_length=1)

    @field_validator("faceIndices")
    @classmethod
    def dedupe_sorted(cls, value: list[int]) -> list[int]:
        deduped = sorted(set(value))
        return deduped


class ForceDef(BaseModel):
    point: tuple[float, float, float]
    direction: tuple[float, float, float]
    magnitude: float = Field(gt=0)
    unit: Literal["N", "lb"]
    label: Optional[str] = None


class LoadCase(BaseModel):
    id: str = Field(min_length=1)
    fixedRegions: list[str] = Field(min_length=1)
    forces: list[ForceDef] = Field(min_length=1)


class RunTargets(BaseModel):
    safetyFactor: float = Field(ge=1.0)
    outcomeCount: int = Field(ge=2, le=12)
    massReductionGoalPct: float = Field(ge=1.0, le=90.0)


class StudyCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: EncodedModel
    units: Literal["mm", "in", "m"]
    designRegion: DesignRegion
    preservedRegions: list[FaceRegion] = Field(min_length=1)
    obstacleRegions: list[FaceRegion] = Field(default_factory=list)
    loadCases: list[LoadCase] = Field(min_length=1)
    material: Literal[
        "Aluminum 6061",
        "PLA",
        "PETG",
        "ABS",
        "ASA",
        "Nylon (PA12)",
        "Polycarbonate (PC)",
    ]
    targets: RunTargets


class RunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    qualityProfile: Literal["high-fidelity", "balanced", "fast-preview"] = "balanced"
    seed: Optional[int] = Field(default=None, ge=0)
    outcomeCountOverride: Optional[int] = Field(default=None, ge=1, le=12)


class StudyDefinition(StudyCreateRequest):
    id: str
    createdAt: str


class OutcomeMetricsV2(BaseModel):
    baselineVolume: float
    volume: float
    mass: float
    massReductionPct: float
    stressProxy: float
    displacementProxy: float
    safetyIndexProxy: float
    complianceProxy: float


class OutcomeV2(BaseModel):
    id: str
    optimizedModel: EncodedModel
    metrics: OutcomeMetricsV2
    variantParams: Optional[dict[str, Any]] = None
    warnings: Optional[list[str]] = None


class StudyCreateResponse(BaseModel):
    study: StudyDefinition


class StudyRunResponse(BaseModel):
    jobId: str
    statusUrl: str


class OutcomesResponse(BaseModel):
    studyId: str
    outcomes: list[OutcomeV2]


class JobStateV2(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


class JobStageV2(str, Enum):
    queued = "queued"
    parse = "parse"
    constraint_map = "constraint-map"
    voxelize = "voxelize"
    fem_solve = "fem-solve"
    topology_opt = "topology-opt"
    reconstruct = "reconstruct"
    rank_export = "rank-export"
    complete = "complete"
    failed = "failed"


class JobStatusV2(BaseModel):
    jobId: str
    studyId: str
    status: JobStateV2
    stage: JobStageV2
    progress: float = Field(ge=0.0, le=1.0)
    etaSeconds: Optional[int] = None
    warnings: list[str] = Field(default_factory=list)
    solverVersion: str
    error: Optional[str] = None
    outcomes: Optional[list[OutcomeV2]] = None


class BenchmarkReport(BaseModel):
    baselineVolume: float
    targetMassReductionPct: float
    notes: list[str]


class BenchmarkResponse(BaseModel):
    id: str
    name: str
    description: str
    defaultStudy: dict[str, Any]
    report: BenchmarkReport


class MaterialDef(BaseModel):
    id: str
    name: str
    densityKgM3: float
    elasticModulusGPa: float
    yieldStrengthMPa: float
    default: bool


class MaterialsResponse(BaseModel):
    materials: list[MaterialDef]
