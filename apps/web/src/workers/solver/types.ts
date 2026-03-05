import type { OutcomeV2, StudyCreateRequest } from "@contracts/index";

export type BrowserQualityProfile = "high-fidelity" | "balanced" | "fast-preview";

export type WorkerStage =
  | "queued"
  | "parse"
  | "constraint-map"
  | "voxelize"
  | "fem-solve"
  | "topology-opt"
  | "reconstruct"
  | "rank-export"
  | "complete";

export type WorkerStatus = "queued" | "running" | "succeeded";

export interface BrowserSolveGeometry {
  positions: Float32Array;
}

export interface BrowserSolvePayload {
  request: StudyCreateRequest;
  geometry: BrowserSolveGeometry;
  qualityProfile: BrowserQualityProfile;
}

export type WorkerInMessage = {
  type: "solve";
  payload: BrowserSolvePayload;
};

export type WorkerProgressMessage = {
  type: "progress";
  stage: WorkerStage;
  progress: number;
  status: WorkerStatus;
  qualityProfile: BrowserQualityProfile;
  warnings: string[];
  etaSeconds?: number;
};

export type WorkerResultMessage = {
  type: "result";
  outcomes: OutcomeV2[];
  qualityProfile: BrowserQualityProfile;
  warnings: string[];
};

export type WorkerErrorMessage = {
  type: "error";
  error: string;
};

export type WorkerOutMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

export interface ForceVec {
  point: [number, number, number];
  direction: [number, number, number];
  magnitudeN: number;
}

export interface PreservedData {
  allFaces: Set<number>;
  groups: number[][];
}

export interface QualityProfileConfig {
  id: BrowserQualityProfile;
  targetVoxels: number;
  minThicknessVoxels: number;
  smoothIterations: number;
  taubinIterations: number;
  densityIterations: number;
  connectivityIterations: number;
  maxTriangles: number;
}

export interface VariantParams {
  targetVolumeFraction: number;
  directionWeight: number;
  connectivityWeight: number;
  boundaryWeight: number;
  smoothFactor: number;
  minThickness: number;
  ribBoost: number;
}

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  total: number;
  origin: [number, number, number];
  step: number;
}

export interface DensitySolveResult {
  density: Float32Array;
  occupancy: Uint8Array;
  volumeFraction: number;
}

export interface VariantResult {
  id: string;
  density: Float32Array;
  occupancy: Uint8Array;
  params: VariantParams;
}
