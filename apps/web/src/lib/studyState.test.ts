import * as THREE from "three";
import { applyFaceLabels, buildSolvePayload, initializeFaceLabels, normalizeDirection } from "./studyState";
import { describe, expect, it } from "vitest";

describe("study state helpers", () => {
  it("applies brush labels and keeps existing labels", () => {
    const initial = initializeFaceLabels(5);
    const once = applyFaceLabels(initial, [1, 3], "preserved");
    const twice = applyFaceLabels(once, [4], "design");

    expect(twice).toEqual(["design", "preserved", "design", "preserved", "design"]);
  });

  it("normalizes direction vectors", () => {
    expect(normalizeDirection([0, 0, 0])).toEqual([0, 0, 1]);
    const normalized = normalizeDirection([3, 0, 4]);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[2]).toBeCloseTo(0.8);
  });

  it("builds solve payload with preserved region map", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const payload = buildSolvePayload({
      model: {
        fileName: "part.obj",
        format: "obj",
        dataBase64: "AAAA",
        geometry,
        solveGeometry: geometry,
        solveToDisplayOffset: [0.5, 0, -1]
      },
      units: "mm",
      faceLabels: ["fixed", "fixed", "preserved", "preserved", "obstacle", "design", "design", "design", "design", "design", "design", "design"],
      forces: [
        {
          id: "f1",
          point: [0, 0, 0],
          direction: [0, 0, -5],
          normal: [0, 0, 1],
          magnitude: 10,
          unit: "lb",
          label: "10lb"
        }
      ],
      material: "PETG",
      targetSafetyFactor: 2,
      outcomeCount: 4,
      massReductionGoalPct: 45
    });

    expect(payload.preservedRegions[0].id).toBe("fixed-1");
    expect(payload.preservedRegions[1].id).toBe("preserved-1");
    expect(payload.loadCases[0].fixedRegions).toEqual(["fixed-1"]);
    expect(payload.loadCases[0].forces[0].direction[2]).toBeCloseTo(-1);
    expect(payload.loadCases[0].forces[0].point).toEqual([-0.5, 0, 1]);
    expect(payload.targets.massReductionGoalPct).toBe(45);
  });
});
