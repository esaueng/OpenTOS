import { applyFaceLabels, buildSolvePayload, initializeFaceLabels, normalizeDirection } from "./studyState";

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
    const payload = buildSolvePayload({
      model: {
        fileName: "part.obj",
        format: "obj",
        dataBase64: "AAAA",
        geometry: {} as never
      },
      units: "mm",
      faceLabels: ["design", "preserved", "design"],
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
      material: "Aluminum 6061",
      targetSafetyFactor: 2,
      outcomeCount: 4,
      manufacturingConstraint: "Additive"
    });

    expect(payload.preservedRegions[0].faceIndices).toEqual([1]);
    expect(payload.forces[0].direction[2]).toBeCloseTo(-1);
  });
});
