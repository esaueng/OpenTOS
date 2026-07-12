export type DistanceUnit = "mm" | "in" | "m";
export type ForceUnit = "N" | "lb";
export type ModelFormat = "stl" | "obj" | "glb";
export type QualityProfile = "high-fidelity" | "balanced" | "fast-preview";
export type MaterialName =
  | "Aluminum 6061"
  | "PLA"
  | "PETG"
  | "ABS"
  | "ASA"
  | "Nylon (PA12)"
  | "Polycarbonate (PC)";

export type JobStateV2 = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type JobStageV2 =
  | "queued"
  | "parse"
  | "constraint-map"
  | "voxelize"
  | "fem-solve"
  | "topology-opt"
  | "reconstruct"
  | "rank-export"
  | "complete"
  | "failed";

export interface EncodedModel {
  format: ModelFormat;
  dataBase64: string;
}

export interface FaceRegion {
  id: string;
  faceIndices: number[];
}

export interface ForceDef {
  point: [number, number, number];
  direction: [number, number, number];
  magnitude: number;
  unit: ForceUnit;
  label?: string;
}

export interface LoadCase {
  id: string;
  fixedRegions: string[];
  forces: ForceDef[];
}

export interface ConstraintSet {
  designRegion: {
    faceIndices: number[];
  };
  preservedRegions: FaceRegion[];
  obstacleRegions: FaceRegion[];
}

export interface RunTargets {
  safetyFactor: number;
  outcomeCount: number;
  massReductionGoalPct: number;
}

export interface StudyCreateRequest {
  model: EncodedModel;
  units: DistanceUnit;
  designRegion: {
    faceIndices: number[];
  };
  preservedRegions: FaceRegion[];
  obstacleRegions: FaceRegion[];
  loadCases: LoadCase[];
  material: MaterialName;
  targets: RunTargets;
}

export interface StudyDefinition extends StudyCreateRequest {
  id: string;
  createdAt: string;
}

export interface RunOptions {
  qualityProfile?: QualityProfile;
  seed?: number;
  outcomeCountOverride?: number;
}

export interface OutcomeMetricsV2 {
  baselineVolume: number;
  volume: number;
  mass: number;
  massReductionPct: number;
  stressProxy: number;
  displacementProxy: number;
  safetyIndexProxy: number;
  complianceProxy: number;
}

export interface OutcomeV2 {
  id: string;
  optimizedModel: {
    format: "glb";
    dataBase64: string;
  };
  metrics: OutcomeMetricsV2;
  variantParams?: Record<string, string | number | boolean>;
  warnings?: string[];
}

export interface StudyCreateResponse {
  study: StudyDefinition;
}

export interface StudyRunResponse {
  jobId: string;
  statusUrl: string;
}

export interface OutcomesResponse {
  studyId: string;
  outcomes: OutcomeV2[];
}

export interface JobStatusV2 {
  jobId: string;
  studyId: string;
  status: JobStateV2;
  stage: JobStageV2;
  progress: number;
  etaSeconds?: number;
  warnings: string[];
  solverVersion: string;
  error?: string;
  outcomes?: OutcomeV2[];
}

export interface BenchmarkReport {
  baselineVolume: number;
  targetMassReductionPct: number;
  notes: string[];
}

export interface BenchmarkResponse {
  id: string;
  name: string;
  description: string;
  defaultStudy: Omit<StudyCreateRequest, "model">;
  report: BenchmarkReport;
}

export interface MaterialDef {
  id: string;
  name: string;
  densityKgM3: number;
  elasticModulusGPa: number;
  yieldStrengthMPa: number;
  default: boolean;
}

export interface MaterialsResponse {
  materials: MaterialDef[];
}

// Project-oriented v3 contract. The original study/job interfaces above remain
// the compatibility surface for existing clients.
export type ArtifactKind = "source-model" | "optimized-model" | "report" | "solver-log";
export type VerificationStatus = "preview" | "verified" | "failed";
export type RunState = "draft" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface ArtifactRef {
  id: string;
  kind: ArtifactKind;
  mediaType: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  downloadUrl: string;
}

export interface MeshDiagnostics {
  triangleCount: number;
  vertexCount: number;
  bodyCount: number;
  watertight: boolean;
  windingConsistent: boolean;
  bounds: [number, number, number];
  warnings: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeStudyId?: string;
  activeRunId?: string;
}

export interface ModelRevision {
  id: string;
  projectId: string;
  createdAt: string;
  units: DistanceUnit;
  format: ModelFormat;
  source: ArtifactRef;
  diagnostics: MeshDiagnostics;
}

export interface ManufacturingConstraints {
  minimumThickness: number;
  symmetry?: "none" | "x" | "y" | "z";
  overhangAngleDeg?: number;
  process: "unconstrained" | "additive" | "milling-3-axis";
}

export interface StudyDraftV3 {
  id: string;
  projectId: string;
  modelRevisionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  units: DistanceUnit;
  material: MaterialName;
  constraints: ConstraintSet;
  loadCases: LoadCase[];
  targets: RunTargets;
  manufacturing: ManufacturingConstraints;
  revision: number;
}

export interface ConstraintCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "not-run";
  actual?: number;
  target?: number;
  unit?: string;
  message: string;
}

export interface SolverProvenance {
  solver: string;
  version: string;
  method: string;
  fidelity: VerificationStatus;
  meshElements: number;
  iterations: number;
  converged: boolean;
  startedAt: string;
  completedAt: string;
  configurationHash: string;
}

export interface OutcomeV3 {
  id: string;
  runId: string;
  rank: number;
  status: VerificationStatus;
  model: ArtifactRef;
  metrics: OutcomeMetricsV2;
  checks: ConstraintCheck[];
  provenance: SolverProvenance;
  warnings: string[];
}

export interface SolverRunV3 {
  id: string;
  projectId: string;
  studyId: string;
  state: RunState;
  stage: JobStageV2;
  progress: number;
  createdAt: string;
  updatedAt: string;
  etaSeconds?: number;
  error?: string;
  warnings: string[];
  outcomes: OutcomeV3[];
}

export interface StudyReadiness {
  ready: boolean;
  blockers: Array<{ code: string; message: string; field?: string }>;
  warnings: Array<{ code: string; message: string; field?: string }>;
  estimatedSeconds: number;
}

export interface MeshReview {
  summary: string;
  confidence: number;
  blockers: string[];
  warnings: string[];
  recommendedActions: string[];
}

export interface StudyPatchOperation {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
  reason: string;
}

export interface CopilotResponse {
  id: string;
  message: string;
  model: string;
  provider: string;
  proposedPatch: StudyPatchOperation[];
  requiresReview: boolean;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  requestId?: string;
  errors?: Array<{ field?: string; message: string }>;
}

export type RegionLabel = "preserved" | "design" | "obstacle" | "fixed" | "unassigned";

export interface RegionLabelMap {
  labelsByFaceIndex: Record<number, RegionLabel>;
}
