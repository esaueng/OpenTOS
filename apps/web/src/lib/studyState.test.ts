import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  applyFaceLabels,
  buildConstraintGroups,
  buildSolvePayload,
  initializeFaceLabels,
  nextSequentialId,
  normalizeDirection
} from "./studyState";
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
          loadCaseId: "LC-1",
          point: [0, 0, 0],
          direction: [0, 0, -5],
          normal: [0, 0, 1],
          magnitude: 10,
          unit: "lb",
          label: "10lb"
        }
      ],
      loadCases: [{ id: "LC-1", fixedRegionIds: ["fixed-0"] }],
      material: "PETG",
      targetSafetyFactor: 2,
      outcomeCount: 4,
      massReductionGoalPct: 45
    });

    expect(payload.preservedRegions[0].id).toBe("fixed-0");
    expect(payload.preservedRegions[1].id).toBe("preserved-2");
    expect(payload.loadCases[0].fixedRegions).toEqual(["fixed-0"]);
    expect(payload.loadCases[0].forces[0].direction[2]).toBeCloseTo(-1);
    expect(payload.loadCases[0].forces[0].point).toEqual([-0.5, 0, 1]);
    expect(payload.targets.massReductionGoalPct).toBe(45);
  });

  it("keeps distinct fixed and preserved groups across multiple load cases", () => {
    const left = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    left.translate(-2, 0, 0);
    const right = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    right.translate(2, 0, 0);
    const geometry = BufferGeometryUtils.mergeGeometries([left, right], false)!;
    const faceLabels = initializeFaceLabels(24);

    const labeled = applyFaceLabels(faceLabels, [0, 1], "fixed");
    const labeled2 = applyFaceLabels(labeled, [2, 3], "preserved");
    const labeled3 = applyFaceLabels(labeled2, [12, 13], "fixed");
    const labeled4 = applyFaceLabels(labeled3, [14, 15], "preserved");

    const payload = buildSolvePayload({
      model: {
        fileName: "part.obj",
        format: "obj",
        dataBase64: "AAAA",
        geometry,
        solveGeometry: geometry,
        solveToDisplayOffset: [0, 0, 0]
      },
      units: "mm",
      faceLabels: labeled4,
      forces: [
        {
          id: "f1",
          loadCaseId: "LC-1",
          point: [0, 0, 0],
          direction: [1, 0, 0],
          normal: [1, 0, 0],
          magnitude: 10,
          unit: "lb",
          label: "F-1"
        },
        {
          id: "f2",
          loadCaseId: "LC-2",
          point: [0, 0, 0],
          direction: [0, 1, 0],
          normal: [0, 1, 0],
          magnitude: 20,
          unit: "N",
          label: "F-2"
        }
      ],
      loadCases: [
        { id: "LC-1", fixedRegionIds: ["fixed-0"] },
        { id: "LC-2", fixedRegionIds: ["fixed-12"] }
      ],
      material: "PETG",
      targetSafetyFactor: 2,
      outcomeCount: 4,
      massReductionGoalPct: 45
    });

    expect(payload.preservedRegions.map((region) => region.id)).toEqual([
      "fixed-0",
      "fixed-12",
      "preserved-2",
      "preserved-14"
    ]);
    expect(payload.loadCases).toHaveLength(2);
    expect(payload.loadCases[0].fixedRegions).toEqual(["fixed-0"]);
    expect(payload.loadCases[1].fixedRegions).toEqual(["fixed-12"]);
  });

  it("keeps region ids stable when an earlier group is painted later", () => {
    const left = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    left.translate(-2, 0, 0);
    const right = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    right.translate(2, 0, 0);
    const geometry = BufferGeometryUtils.mergeGeometries([left, right], false)!;

    const onlyRight = applyFaceLabels(initializeFaceLabels(24), [12, 13], "fixed");
    const before = buildConstraintGroups(geometry, onlyRight);
    expect(before.fixedRegions.map((region) => region.id)).toEqual(["fixed-12"]);

    // Painting a new fixed group earlier in face order must not change the
    // identity of the existing group; load-case references rely on this.
    const withLeft = applyFaceLabels(onlyRight, [0, 1], "fixed");
    const after = buildConstraintGroups(geometry, withLeft);
    expect(after.fixedRegions.map((region) => region.id)).toEqual(["fixed-0", "fixed-12"]);

    const rightRegionBefore = before.fixedRegions[0];
    const rightRegionAfter = after.fixedRegions.find((region) => region.id === "fixed-12");
    expect(rightRegionAfter?.faceIndices).toEqual(rightRegionBefore.faceIndices);
  });

  it("mints non-colliding sequential ids after deletions", () => {
    expect(nextSequentialId([], "F")).toBe("F-1");
    expect(nextSequentialId(["F-1", "F-2"], "F")).toBe("F-3");
    // After deleting F-1, the next id must not collide with the surviving F-2.
    expect(nextSequentialId(["F-2"], "F")).toBe("F-3");
    expect(nextSequentialId(["LC-1", "LC-10", "F-99"], "LC")).toBe("LC-11");
  });
});
