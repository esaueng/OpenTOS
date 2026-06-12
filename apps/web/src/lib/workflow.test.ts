import { describe, expect, it } from "vitest";

import {
  canNavigateToStep,
  canRunStudy,
  missingRunItems,
  nextStep,
  previousStep,
  runChecklist,
  stepCompletion,
  type WorkflowSnapshot
} from "./workflow";

function snapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    hasModel: false,
    preservedCount: 0,
    fixedCount: 0,
    obstacleCount: 0,
    forces: [],
    loadCases: [{ id: "LC-1", fixedRegionIds: [] }],
    outcomeCount: 0,
    running: false,
    ...overrides
  };
}

describe("workflow model", () => {
  it("marks nothing complete on an empty workspace", () => {
    const completion = stepCompletion(snapshot());
    expect(Object.values(completion).every((done) => !done)).toBe(true);
  });

  it("requires forces and anchored load cases for the loads step", () => {
    const withForce = snapshot({
      hasModel: true,
      forces: [{ id: "F-1", loadCaseId: "LC-1" }]
    });
    expect(stepCompletion(withForce).loads).toBe(false);

    const anchored = snapshot({
      hasModel: true,
      forces: [{ id: "F-1", loadCaseId: "LC-1" }],
      loadCases: [{ id: "LC-1", fixedRegionIds: ["fixed-0"] }]
    });
    expect(stepCompletion(anchored).loads).toBe(true);
  });

  it("ignores empty load cases when judging readiness", () => {
    const ready = snapshot({
      hasModel: true,
      fixedCount: 2,
      forces: [{ id: "F-1", loadCaseId: "LC-1" }],
      loadCases: [
        { id: "LC-1", fixedRegionIds: ["fixed-0"] },
        { id: "LC-2", fixedRegionIds: [] }
      ]
    });
    expect(stepCompletion(ready).loads).toBe(true);
    expect(missingRunItems(ready)).toEqual([]);
    expect(canRunStudy(ready)).toBe(true);
  });

  it("locks steps without a model and results without outcomes", () => {
    const empty = snapshot();
    expect(canNavigateToStep("model", empty)).toBe(true);
    expect(canNavigateToStep("preserve", empty)).toBe(false);
    expect(canNavigateToStep("generate", empty)).toBe(false);

    const modeled = snapshot({ hasModel: true });
    expect(canNavigateToStep("preserve", modeled)).toBe(true);
    expect(canNavigateToStep("results", modeled)).toBe(false);
    expect(canNavigateToStep("results", snapshot({ hasModel: true, running: true }))).toBe(true);
    expect(canNavigateToStep("results", snapshot({ hasModel: true, outcomeCount: 2 }))).toBe(true);
  });

  it("reports missing run items in workflow order and treats preserved as optional", () => {
    const missing = missingRunItems(snapshot());
    expect(missing).toEqual([
      "Model loaded",
      "Fixed surface marked",
      "Force assigned to a load case",
      "Load cases reference a fixed surface"
    ]);

    const preservedItem = runChecklist(snapshot()).find((item) => item.id === "preserved");
    expect(preservedItem?.optional).toBe(true);
  });

  it("blocks running while a job is in flight", () => {
    const ready = snapshot({
      hasModel: true,
      fixedCount: 1,
      forces: [{ id: "F-1", loadCaseId: "LC-1" }],
      loadCases: [{ id: "LC-1", fixedRegionIds: ["fixed-0"] }],
      running: true
    });
    expect(missingRunItems(ready)).toEqual([]);
    expect(canRunStudy(ready)).toBe(false);
  });

  it("walks steps in order", () => {
    expect(nextStep("model")).toBe("preserve");
    expect(previousStep("preserve")).toBe("model");
    expect(nextStep("results")).toBeNull();
    expect(previousStep("model")).toBeNull();
  });
});
