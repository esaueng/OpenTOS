export type DistanceUnit = "mm" | "in" | "m";
export type ForceUnit = "N" | "lb";
export type ModelFormat = "stl" | "obj" | "glb";
export type QualityProfile = "high-fidelity" | "balanced" | "fast-preview";

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
  material: "Aluminum 6061";
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

export type RegionLabel = "preserved" | "design" | "obstacle" | "fixed" | "unassigned";

export interface RegionLabelMap {
  labelsByFaceIndex: Record<number, RegionLabel>;
}
