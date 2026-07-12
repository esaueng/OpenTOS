from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.contracts import FaceRegion, LoadCase, OutcomeMetricsV2, RunTargets


DistanceUnit = Literal["mm", "in", "m"]
ModelFormat = Literal["stl", "obj", "glb"]
MaterialName = Literal[
    "Aluminum 6061",
    "PLA",
    "PETG",
    "ABS",
    "ASA",
    "Nylon (PA12)",
    "Polycarbonate (PC)",
]
VerificationStatus = Literal["preview", "verified", "failed"]


class ProblemDetails(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str
    instance: str | None = None
    code: str
    requestId: str | None = None
    errors: list[dict[str, str]] | None = None


class ArtifactRef(BaseModel):
    id: str
    kind: Literal["source-model", "optimized-model", "report", "solver-log"]
    mediaType: str
    fileName: str
    byteSize: int
    sha256: str
    downloadUrl: str


class MeshDiagnostics(BaseModel):
    triangleCount: int
    vertexCount: int
    bodyCount: int
    watertight: bool
    windingConsistent: bool
    bounds: tuple[float, float, float]
    warnings: list[str] = Field(default_factory=list)


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)


class ProjectSummary(BaseModel):
    id: str
    name: str
    createdAt: str
    updatedAt: str
    activeStudyId: str | None = None
    activeRunId: str | None = None


class ModelRevision(BaseModel):
    id: str
    projectId: str
    createdAt: str
    units: DistanceUnit
    format: ModelFormat
    source: ArtifactRef
    diagnostics: MeshDiagnostics


class ManufacturingConstraints(BaseModel):
    minimumThickness: float = Field(gt=0)
    symmetry: Literal["none", "x", "y", "z"] = "none"
    overhangAngleDeg: float | None = Field(default=None, gt=0, le=90)
    process: Literal["unconstrained", "additive", "milling-3-axis"] = "unconstrained"


class ConstraintSet(BaseModel):
    designRegion: dict[str, list[int]]
    preservedRegions: list[FaceRegion]
    obstacleRegions: list[FaceRegion] = Field(default_factory=list)


class StudyDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modelRevisionId: str
    name: str = Field(min_length=1, max_length=120)
    units: DistanceUnit
    material: MaterialName
    constraints: ConstraintSet
    loadCases: list[LoadCase]
    targets: RunTargets
    manufacturing: ManufacturingConstraints


class StudyDraft(StudyDraftCreate):
    id: str
    projectId: str
    createdAt: str
    updatedAt: str
    revision: int


class StudyReadiness(BaseModel):
    ready: bool
    blockers: list[dict[str, str]] = Field(default_factory=list)
    warnings: list[dict[str, str]] = Field(default_factory=list)
    estimatedSeconds: int


class RunCreate(BaseModel):
    qualityProfile: Literal["high-fidelity", "balanced", "fast-preview"] = "balanced"
    seed: int = Field(default=0, ge=0)
    verification: Literal["preview", "linear-static"] = "preview"


class ConstraintCheck(BaseModel):
    id: str
    label: str
    status: Literal["pass", "fail", "warning", "not-run"]
    actual: float | None = None
    target: float | None = None
    unit: str | None = None
    message: str


class SolverProvenance(BaseModel):
    solver: str
    version: str
    method: str
    fidelity: VerificationStatus
    meshElements: int
    iterations: int
    converged: bool
    startedAt: str
    completedAt: str
    configurationHash: str


class OutcomeV3(BaseModel):
    id: str
    runId: str
    rank: int
    status: VerificationStatus
    model: ArtifactRef
    metrics: OutcomeMetricsV2
    checks: list[ConstraintCheck]
    provenance: SolverProvenance
    warnings: list[str] = Field(default_factory=list)


class SolverRun(BaseModel):
    id: str
    projectId: str
    studyId: str
    state: Literal["draft", "queued", "running", "succeeded", "failed", "canceled"]
    stage: str
    progress: float = Field(ge=0, le=1)
    createdAt: str
    updatedAt: str
    etaSeconds: int | None = None
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)
    outcomes: list[OutcomeV3] = Field(default_factory=list)


class CopilotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=8000)
    studyId: str | None = None
    outcomeIds: list[str] = Field(default_factory=list, max_length=12)


class StudyPatchOperation(BaseModel):
    op: Literal["replace", "add", "remove"]
    path: str
    value: Any | None = None
    reason: str


class CopilotResponse(BaseModel):
    id: str
    message: str
    model: str
    provider: str
    proposedPatch: list[StudyPatchOperation] = Field(default_factory=list)
    requiresReview: bool = True


class CopilotStructuredOutput(BaseModel):
    message: str
    proposedPatch: list[StudyPatchOperation] = Field(default_factory=list)
    requiresReview: bool = True
