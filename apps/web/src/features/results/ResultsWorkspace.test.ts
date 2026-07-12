import { describe, expect, it } from "vitest";

import { formatMass } from "./ResultsWorkspace";

describe("formatMass", () => {
  it("keeps small preview parts legible", () => {
    expect(formatMass(0.0002)).toBe("200 mg");
    expect(formatMass(0.02)).toBe("20 g");
    expect(formatMass(2)).toBe("2 kg");
  });
});
