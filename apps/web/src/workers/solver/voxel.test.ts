import { describe, expect, it } from "vitest";

import { index3D } from "./math";
import type { VoxelGrid } from "./types";
import { dilateMask, erodeMask } from "./voxel";

function makeGrid(n: number): VoxelGrid {
  return {
    nx: n,
    ny: n,
    nz: n,
    total: n * n * n,
    origin: [0, 0, 0],
    step: 1
  };
}

function centeredCube(grid: VoxelGrid, halfWidth: number): Uint8Array {
  const mask = new Uint8Array(grid.total);
  const c = Math.floor(grid.nx / 2);
  for (let z = c - halfWidth; z <= c + halfWidth; z += 1) {
    for (let y = c - halfWidth; y <= c + halfWidth; y += 1) {
      for (let x = c - halfWidth; x <= c + halfWidth; x += 1) {
        mask[index3D(grid, x, y, z)] = 1;
      }
    }
  }
  return mask;
}

function countSet(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      count += 1;
    }
  }
  return count;
}

describe("voxel morphology", () => {
  it("dilation grows and erosion shrinks the mask", () => {
    const grid = makeGrid(16);
    const mask = centeredCube(grid, 2);
    const base = countSet(mask);

    expect(countSet(dilateMask(mask, grid, 1))).toBeGreaterThan(base);
    expect(countSet(erodeMask(mask, grid, 1))).toBeLessThan(base);
  });

  it("does not mutate the input mask for multi-iteration dilation", () => {
    const grid = makeGrid(16);
    const mask = centeredCube(grid, 2);
    const snapshot = mask.slice();

    const dilated = dilateMask(mask, grid, 3);

    expect(mask).toEqual(snapshot);
    expect(dilated).not.toBe(mask);
    expect(countSet(dilated)).toBeGreaterThan(countSet(snapshot));
  });

  it("does not mutate the input mask for multi-iteration erosion", () => {
    const grid = makeGrid(16);
    const mask = centeredCube(grid, 4);
    const snapshot = mask.slice();

    const eroded = erodeMask(mask, grid, 2);

    expect(mask).toEqual(snapshot);
    expect(countSet(eroded)).toBeLessThan(countSet(snapshot));
  });

  it("dilate followed by erode restores a solid cube", () => {
    const grid = makeGrid(16);
    const mask = centeredCube(grid, 3);

    const closed = erodeMask(dilateMask(mask, grid, 2), grid, 2);

    expect(closed).toEqual(mask);
  });
});
