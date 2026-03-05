import type { Outcome, SolveRequest } from "@contracts/index";
import type * as THREE from "three";

export type RegionLabel = "preserved" | "design" | "unassigned";

export type BrowserQualityProfile = "high-fidelity" | "balanced" | "fast-preview";

export interface UploadedModel {
  fileName: string;
  format: "stl" | "obj" | "glb";
  dataBase64: string;
  geometry: THREE.BufferGeometry;
  solveGeometry: THREE.BufferGeometry;
  solveToDisplayOffset: [number, number, number];
}

export interface ForceState {
  id: string;
  point: [number, number, number];
  direction: [number, number, number];
  normal: [number, number, number];
  magnitude: number;
  unit: "N" | "lb";
  label: string;
}

export interface StudySettings {
  units: "mm" | "in" | "m";
  material: "Aluminum 6061";
  targetSafetyFactor: number;
  manufacturingConstraint: "3-axis milling" | "Additive";
  outcomeCount: number;
}

export interface BrowserSolveConfig {
  qualityProfile: BrowserQualityProfile;
}

export interface JobStatus {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  stage: "queued" | "parse" | "voxelize" | "field-solve" | "variant-synth" | "export" | "complete" | "failed";
  progress: number;
  qualityProfile?: BrowserQualityProfile;
  warnings?: string[];
  etaSeconds?: number;
  error?: string;
  outcomes?: Outcome[];
}

export interface BuildSolvePayloadArgs {
  model: UploadedModel;
  units: StudySettings["units"];
  faceLabels: RegionLabel[];
  forces: ForceState[];
  material: StudySettings["material"];
  targetSafetyFactor: number;
  outcomeCount: number;
  manufacturingConstraint: StudySettings["manufacturingConstraint"];
}

export type SolvePayload = SolveRequest;
