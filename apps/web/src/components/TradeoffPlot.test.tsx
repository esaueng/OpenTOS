import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OutcomeV2 } from "@contracts/index";

import { projectOutcomes, TradeoffPlot } from "./TradeoffPlot";

const outcomes: OutcomeV2[] = [
  {
    id: "OUT-01",
    optimizedModel: { format: "glb", dataBase64: "" },
    metrics: { baselineVolume: 100, volume: 70, mass: 200, massReductionPct: 30, stressProxy: 10, displacementProxy: 1, safetyIndexProxy: 2.5, complianceProxy: 1 }
  },
  {
    id: "OUT-02",
    optimizedModel: { format: "glb", dataBase64: "" },
    metrics: { baselineVolume: 100, volume: 60, mass: 150, massReductionPct: 40, stressProxy: 12, displacementProxy: 1.2, safetyIndexProxy: 2.1, complianceProxy: 1.1 }
  }
];

describe("TradeoffPlot", () => {
  it("projects lighter outcomes further left and safer outcomes higher", () => {
    const points = projectOutcomes(outcomes);
    expect(points[1].x).toBeLessThan(points[0].x);
    expect(points[0].y).toBeLessThan(points[1].y);
  });

  it("allows keyboard selection", () => {
    const onSelect = vi.fn();
    render(<TradeoffPlot outcomes={outcomes} selectedOutcomeId="OUT-01" targetSafetyFactor={2} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /OUT-02/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("OUT-02");
  });
});
