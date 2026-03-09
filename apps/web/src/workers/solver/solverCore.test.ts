import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildVoxelGrid } from "./geometry";
import { computeBaseInfluenceFields, combineInfluenceFields } from "./fields";
import { makePreservedGeometry } from "./mesh";
import { solveDensityField } from "./optimize";
import { variantParams } from "./variants";
import { distanceFromMask, forceSeedMask, rasterizePreservedMask, voxelizeDomain } from "./voxel";

function cubePositions(size = 1): Float32Array {
  const geometry = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  return (geometry.getAttribute("position").array as Float32Array).slice();
}

describe("solver core", () => {
  it("voxelizes a closed mesh into a non-empty domain", () => {
    const positions = cubePositions(1);
    const grid = buildVoxelGrid(positions, 140_000);
    const { domainMask } = voxelizeDomain(positions, grid);

    const occupied = domainMask.reduce((sum, v) => sum + v, 0);
    expect(occupied).toBeGreaterThan(2000);
  });

  it("preserved extraction keeps exact triangles", () => {
    const positions = cubePositions(1);
    const preserved = makePreservedGeometry(positions, new Set([0, 1]));
    const arr = preserved.getAttribute("position").array as Float32Array;

    expect(arr.length).toBe(18);
    expect(arr[0]).toBeCloseTo(positions[0]);
    expect(arr[17]).toBeCloseTo(positions[17]);
  });

  it("influence field is stronger near force axis than far region", () => {
    const positions = cubePositions(1.2);
    const grid = buildVoxelGrid(positions, 180_000);
    const { domainMask } = voxelizeDomain(positions, grid);

    const preserveMask = rasterizePreservedMask(positions, new Set([0, 1, 2]), grid, grid.step * 0.9);
    const forceSeeds = forceSeedMask([{ point: [0.55, 0, 0] }], domainMask, grid);

    const preservedDistance = distanceFromMask(preserveMask, domainMask, grid);
    const forceDistance = distanceFromMask(forceSeeds, domainMask, grid);

    const base = computeBaseInfluenceFields(
      grid,
      domainMask,
      preserveMask,
      preservedDistance,
      forceDistance,
      [
        {
          point: [0.55, 0, 0],
          direction: [-1, 0, 0],
          magnitudeN: 100
        }
      ],
      [{ point: [-0.55, 0, 0], weight: 1 }],
      5
    );

    const influence = combineInfluenceFields(base, domainMask, variantParams(0, 4, 2), 2);

    let nearSum = 0;
    let nearCount = 0;
    let farSum = 0;
    let farCount = 0;

    for (let i = 0; i < influence.length; i += 19) {
      if (!domainMask[i]) {
        continue;
      }
      const x = i % grid.nx;
      const y = Math.floor((i / grid.nx) % grid.ny);
      const z = Math.floor(i / (grid.nx * grid.ny));
      const wx = grid.origin[0] + (x + 0.5) * grid.step;
      const wy = grid.origin[1] + (y + 0.5) * grid.step;
      const wz = grid.origin[2] + (z + 0.5) * grid.step;

      const radial = Math.hypot(wy, wz);
      if (Math.abs(wx) < 0.35 && radial < 0.2) {
        nearSum += influence[i];
        nearCount += 1;
      }
      if (radial > 0.45) {
        farSum += influence[i];
        farCount += 1;
      }
    }

    expect(nearCount).toBeGreaterThan(0);
    expect(farCount).toBeGreaterThan(0);
    expect(nearSum / nearCount).toBeGreaterThan(farSum / farCount);
  });

  it("density solve preserves locked voxels and converges to target band", () => {
    const positions = cubePositions(1.2);
    const grid = buildVoxelGrid(positions, 120_000);
    const { domainMask, surfaceMask } = voxelizeDomain(positions, grid);
    const preserveMask = rasterizePreservedMask(positions, new Set([0, 1]), grid, grid.step * 0.9);
    const oppositeAnchorMask = rasterizePreservedMask(positions, new Set([10, 11]), grid, grid.step * 0.9);
    const anchorMask = new Uint8Array(grid.total);
    for (let i = 0; i < anchorMask.length; i += 1) {
      anchorMask[i] = preserveMask[i] || oppositeAnchorMask[i] ? 1 : 0;
    }
    const surfaceDistance = distanceFromMask(surfaceMask, domainMask, grid);

    const influence = new Float32Array(grid.total);
    for (let i = 0; i < influence.length; i += 1) {
      const x = i % grid.nx;
      influence[i] = domainMask[i] ? 0.42 + (x / Math.max(1, grid.nx - 1)) * 0.48 : 0;
    }

    const solved = solveDensityField({
      grid,
      domainMask,
      preserveMask,
      anchorMask,
      influence,
      targetVolumeFraction: 0.35,
      iterations: 12,
      smoothFactor: 0.25,
      minThickness: 1,
      voidBias: 0.25,
      surfaceDistance
    });

    for (let i = 0; i < preserveMask.length; i += 1) {
      if (preserveMask[i] && domainMask[i]) {
        expect(solved.occupancy[i]).toBe(1);
      }
    }

    expect(solved.volumeFraction).toBeGreaterThan(0.01);
    expect(solved.volumeFraction).toBeLessThan(0.75);
  });

  it("mass target pruning reduces retained material for aggressive volume goals", () => {
    const positions = cubePositions(1.2);
    const grid = buildVoxelGrid(positions, 120_000);
    const { domainMask, surfaceMask } = voxelizeDomain(positions, grid);
    const preserveMask = rasterizePreservedMask(positions, new Set([0, 1]), grid, grid.step * 0.9);
    const forceAnchorMask = rasterizePreservedMask(positions, new Set([10, 11]), grid, grid.step * 0.9);
    const surfaceDistance = distanceFromMask(surfaceMask, domainMask, grid);
    const anchorMask = new Uint8Array(grid.total);
    for (let i = 0; i < anchorMask.length; i += 1) {
      anchorMask[i] = preserveMask[i] || forceAnchorMask[i] ? 1 : 0;
    }

    const influence = new Float32Array(grid.total);
    for (let i = 0; i < influence.length; i += 1) {
      const x = i % grid.nx;
      influence[i] = domainMask[i] ? 0.2 + (x / Math.max(1, grid.nx - 1)) * 0.8 : 0;
    }

    const dense = solveDensityField({
      grid,
      domainMask,
      preserveMask,
      anchorMask,
      influence,
      targetVolumeFraction: 0.55,
      iterations: 10,
      smoothFactor: 0.22,
      minThickness: 1,
      voidBias: 0.12,
      surfaceDistance
    });

    const light = solveDensityField({
      grid,
      domainMask,
      preserveMask,
      anchorMask,
      influence,
      targetVolumeFraction: 0.18,
      iterations: 10,
      smoothFactor: 0.22,
      minThickness: 1,
      voidBias: 0.62,
      surfaceDistance
    });

    expect(light.volumeFraction).toBeLessThan(dense.volumeFraction);
  });

});
