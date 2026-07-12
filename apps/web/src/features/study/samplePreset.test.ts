import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildSamplePreset } from "./samplePreset";

describe("buildSamplePreset", () => {
  it("assigns opposite interfaces and a load on the longest axis", () => {
    const geometry = new THREE.BoxGeometry(10, 2, 2).toNonIndexed();
    const preset = buildSamplePreset({ geometry } as never);

    expect(preset.labels).toContain("fixed");
    expect(preset.labels).toContain("preserved");
    expect(preset.force.point[0]).toBe(5);
    expect(preset.force.normal).toEqual([1, 0, 0]);
  });
});
