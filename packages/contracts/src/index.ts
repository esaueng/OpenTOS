export type DistanceUnit = "mm" | "in" | "m";
export type ForceUnit = "N" | "lb";
export type ModelFormat = "stl" | "obj" | "glb";

export interface EncodedModel {
  format: ModelFormat;
  dataBase64: string;
}

export interface PreservedRegion {
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

export interface SolveRequest {
  model: EncodedModel;
  units: DistanceUnit;
  preservedRegions: PreservedRegion[];
  forces: ForceDef[];
  material: "Aluminum 6061";
  targetSafetyFactor: number;
  outcomeCount: number;
  manufacturingConstraint?: "3-axis milling" | "Additive";
}

export interface OutcomeMetrics {
  volume: number;
  mass: number;
  stressProxy: number;
  displacementProxy: number;
}

export interface Outcome {
  id: string;
  optimizedModel: EncodedModel;
  metrics: OutcomeMetrics;
}

export interface SolveResponse {
  outcomes: Outcome[];
}

export interface SolveAcceptedResponse {
  jobId: string;
  statusUrl: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  stage: "queued" | "parse" | "voxelize" | "field-solve" | "variant-synth" | "export" | "complete" | "failed";
  progress: number;
  error?: string;
  outcomes?: Outcome[];
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

export type RegionLabel = "preserved" | "design" | "unassigned";

export interface RegionLabelMap {
  labelsByFaceIndex: Record<number, RegionLabel>;
}
