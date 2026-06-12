import type { ForceState, LoadCaseState } from "../types";

export type StepId = "model" | "preserve" | "constraints" | "loads" | "study" | "generate" | "results";

export const WORKFLOW_STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: "model", label: "Model" },
  { id: "preserve", label: "Preserve" },
  { id: "constraints", label: "Constraints" },
  { id: "loads", label: "Loads" },
  { id: "study", label: "Study" },
  { id: "generate", label: "Generate" },
  { id: "results", label: "Results" }
] as const;

/** Everything the workflow model needs to derive step and run readiness. */
export interface WorkflowSnapshot {
  hasModel: boolean;
  preservedCount: number;
  fixedCount: number;
  obstacleCount: number;
  forces: Pick<ForceState, "id" | "loadCaseId">[];
  loadCases: Pick<LoadCaseState, "id" | "fixedRegionIds">[];
  outcomeCount: number;
  running: boolean;
}

/** Load cases that have at least one force assigned (the ones that will run). */
export function activeLoadCases(snapshot: WorkflowSnapshot): WorkflowSnapshot["loadCases"] {
  return snapshot.loadCases.filter((loadCase) =>
    snapshot.forces.some((force) => force.loadCaseId === loadCase.id)
  );
}

export function stepCompletion(snapshot: WorkflowSnapshot): Record<StepId, boolean> {
  const active = activeLoadCases(snapshot);
  const loadsReady =
    snapshot.forces.length > 0 &&
    active.length > 0 &&
    active.every((loadCase) => loadCase.fixedRegionIds.length > 0);

  return {
    model: snapshot.hasModel,
    preserve: snapshot.preservedCount > 0,
    constraints: snapshot.fixedCount > 0,
    loads: loadsReady,
    study: snapshot.hasModel,
    generate: snapshot.outcomeCount > 0,
    results: snapshot.outcomeCount > 0
  };
}

export function canNavigateToStep(step: StepId, snapshot: WorkflowSnapshot): boolean {
  if (step === "model") {
    return true;
  }
  if (!snapshot.hasModel) {
    return false;
  }
  if (step === "results") {
    return snapshot.outcomeCount > 0 || snapshot.running;
  }
  return true;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Items the solver does not require but the workflow recommends. */
  optional?: boolean;
}

export function runChecklist(snapshot: WorkflowSnapshot): ChecklistItem[] {
  const active = activeLoadCases(snapshot);
  return [
    {
      id: "model",
      label: "Model loaded",
      done: snapshot.hasModel
    },
    {
      id: "fixed",
      label: "Fixed surface marked",
      done: snapshot.fixedCount > 0
    },
    {
      id: "preserved",
      label: "Preserved interfaces marked",
      done: snapshot.preservedCount > 0,
      optional: true
    },
    {
      id: "forces",
      label: "Force assigned to a load case",
      done: snapshot.forces.length > 0 && active.length > 0
    },
    {
      id: "load-case-anchors",
      label: "Load cases reference a fixed surface",
      done: active.length > 0 && active.every((loadCase) => loadCase.fixedRegionIds.length > 0)
    }
  ];
}

export function missingRunItems(snapshot: WorkflowSnapshot): string[] {
  return runChecklist(snapshot)
    .filter((item) => !item.optional && !item.done)
    .map((item) => item.label);
}

export function canRunStudy(snapshot: WorkflowSnapshot): boolean {
  return !snapshot.running && missingRunItems(snapshot).length === 0;
}

export function nextStep(current: StepId): StepId | null {
  const index = WORKFLOW_STEPS.findIndex((step) => step.id === current);
  return index >= 0 && index < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[index + 1].id : null;
}

export function previousStep(current: StepId): StepId | null {
  const index = WORKFLOW_STEPS.findIndex((step) => step.id === current);
  return index > 0 ? WORKFLOW_STEPS[index - 1].id : null;
}
