import { describe, expect, it } from "vitest";

import { resolveQualityProfile } from "./config";
import { estimateSolverMemoryBytes } from "./geometry";

describe("quality profile resolution", () => {
  it("keeps the requested profile inside the default memory budget", () => {
    const resolved = resolveQualityProfile("high-fidelity", 12);
    expect(resolved.profile.id).toBe("high-fidelity");
    expect(resolved.warnings).toEqual([]);
  });

  it("estimates memory from the requested profile, not the largest one", () => {
    // A budget sized between the fast-preview and high-fidelity estimates must
    // accept fast-preview directly without a downgrade warning.
    const fastEstimate = estimateSolverMemoryBytes(550_000, 4);
    const highEstimate = estimateSolverMemoryBytes(3_200_000, 4);
    const budget = (fastEstimate + highEstimate) / 2;

    const resolved = resolveQualityProfile("fast-preview", 4, budget);
    expect(resolved.profile.id).toBe("fast-preview");
    expect(resolved.warnings).toEqual([]);
  });

  it("downgrades to the first profile that fits a tight budget", () => {
    const balancedEstimate = estimateSolverMemoryBytes(1_500_000, 4);
    const resolved = resolveQualityProfile("high-fidelity", 4, balancedEstimate);

    expect(resolved.profile.id).toBe("balanced");
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain("balanced");
  });

  it("falls back to fast-preview with a warning when nothing fits", () => {
    const resolved = resolveQualityProfile("high-fidelity", 4, 1);
    expect(resolved.profile.id).toBe("fast-preview");
    expect(resolved.warnings).toHaveLength(1);
  });

  it("returns fast-preview without a warning when it was requested and nothing fits", () => {
    const resolved = resolveQualityProfile("fast-preview", 4, 1);
    expect(resolved.profile.id).toBe("fast-preview");
    expect(resolved.warnings).toEqual([]);
  });
});
