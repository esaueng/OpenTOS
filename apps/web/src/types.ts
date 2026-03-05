import type { JobStageV2, JobStateV2, OutcomeV2, QualityProfile, StudyCreateRequest } from "@contracts/index";
import type * as THREE from "three";

export type RegionLabel = "preserved" | "design" | "obstacle" | "fixed" | "unassigned";

export type BrowserQualityProfile = QualityProfile;

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
  outcomeCount: number;
  massReductionGoalPct: number;
}

export interface BrowserSolveConfig {
  qualityProfile: BrowserQualityProfile;
}

export interface JobStatus {
  jobId: string;
  studyId: string;
  status: JobStateV2;
  stage: JobStageV2;
  progress: number;
  solverVersion: string;
  qualityProfile?: BrowserQualityProfile;
  warnings?: string[];
  etaSeconds?: number;
  error?: string;
  outcomes?: OutcomeV2[];
}

export interface BuildSolvePayloadArgs {
  model: UploadedModel;
  units: StudySettings["units"];
  faceLabels: RegionLabel[];
  forces: ForceState[];
  material: StudySettings["material"];
  targetSafetyFactor: number;
  outcomeCount: number;
  massReductionGoalPct: number;
}

export type SolvePayload = StudyCreateRequest;
