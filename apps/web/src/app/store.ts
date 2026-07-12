import type { OutcomeV2 } from "@contracts/index";
import { create } from "zustand";

import type {
  BrowserQualityProfile,
  ForceState,
  JobStatus,
  LoadCaseState,
  RegionLabel,
  StudySettings,
  UploadedModel
} from "../types";

export type WorkspaceTool = "select" | "paint" | "orbit" | "section";
export type MetricMode = "outcome" | "stress" | "displacement";

interface StudyWorkspaceState {
  projectName: string;
  model: UploadedModel | null;
  faceLabels: RegionLabel[];
  settings: StudySettings;
  qualityProfile: BrowserQualityProfile;
  loadCases: LoadCaseState[];
  selectedLoadCaseId: string;
  forces: ForceState[];
  selectedForceId: string | null;
  tool: WorkspaceTool;
  paintLabel: RegionLabel | null;
  brushRadius: number;
  placeForceMode: boolean;
  outcomes: OutcomeV2[];
  selectedOutcomeId: string | null;
  showOriginal: boolean;
  showOutcome: boolean;
  wireframe: boolean;
  metricMode: MetricMode;
  jobStatus: JobStatus | null;
  warnings: string[];
  error: string | null;
  isRunning: boolean;
  platformModelRevisionId: string | null;
  platformStudyId: string | null;
  platformRunId: string | null;
  set: (patch: Partial<Omit<StudyWorkspaceState, "set" | "resetForModel">>) => void;
  resetForModel: (model: UploadedModel, faceLabels: RegionLabel[]) => void;
}

const defaultSettings: StudySettings = {
  units: "mm",
  material: "Aluminum 6061",
  targetSafetyFactor: 2,
  outcomeCount: 4,
  massReductionGoalPct: 45
};

export const useStudyStore = create<StudyWorkspaceState>((set) => ({
  projectName: "Connecting Rod Study",
  model: null,
  faceLabels: [],
  settings: defaultSettings,
  qualityProfile: "balanced",
  loadCases: [{ id: "LC-1", fixedRegionIds: [] }],
  selectedLoadCaseId: "LC-1",
  forces: [],
  selectedForceId: null,
  tool: "select",
  paintLabel: null,
  brushRadius: 0.06,
  placeForceMode: false,
  outcomes: [],
  selectedOutcomeId: null,
  showOriginal: true,
  showOutcome: true,
  wireframe: false,
  metricMode: "outcome",
  jobStatus: null,
  warnings: [],
  error: null,
  isRunning: false,
  platformModelRevisionId: null,
  platformStudyId: null,
  platformRunId: null,
  set: (patch) => set(patch),
  resetForModel: (model, faceLabels) =>
    set({
      model,
      faceLabels,
      loadCases: [{ id: "LC-1", fixedRegionIds: [] }],
      selectedLoadCaseId: "LC-1",
      forces: [],
      selectedForceId: null,
      outcomes: [],
      selectedOutcomeId: null,
      jobStatus: null,
      warnings: [],
      error: null,
      tool: "select",
      paintLabel: null,
      placeForceMode: false,
      platformModelRevisionId: null,
      platformStudyId: null,
      platformRunId: null
    })
}));

export function resetStudyStoreForTests(): void {
  useStudyStore.setState({
    model: null,
    faceLabels: [],
    settings: defaultSettings,
    loadCases: [{ id: "LC-1", fixedRegionIds: [] }],
    selectedLoadCaseId: "LC-1",
    forces: [],
    outcomes: [],
    selectedOutcomeId: null,
    error: null,
    isRunning: false,
    platformModelRevisionId: null,
    platformStudyId: null,
    platformRunId: null
  });
}
