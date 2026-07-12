import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./readiness";

describe("evaluateReadiness", () => {
  it("does not accept an unconstrained active load case", () => {
    const result = evaluateReadiness({
      model: {} as never,
      faceLabels: ["fixed", "preserved"],
      forces: [{ id: "F-1", loadCaseId: "LC-1" } as never],
      loadCases: [{ id: "LC-1", fixedRegionIds: [] }]
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Active load cases constrained");
  });
});
