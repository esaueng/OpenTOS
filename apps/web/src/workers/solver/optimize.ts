import { clamp01, decodeIndex, index3D } from "./math";
import type { DensitySolveResult, VoxelGrid } from "./types";
import { dilateMask, erodeMask } from "./voxel";

interface DensitySolveArgs {
  grid: VoxelGrid;
  domainMask: Uint8Array;
  preserveMask: Uint8Array;
  influence: Float32Array;
  targetVolumeFraction: number;
  iterations: number;
  smoothFactor: number;
  minThickness: number;
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function neighborSmooth(src: Float32Array, domainMask: Uint8Array, grid: VoxelGrid, factor: number): Float32Array {
  const out = new Float32Array(src.length);
  const blend = Math.max(0.05, Math.min(0.95, factor));

  for (let idx = 0; idx < src.length; idx += 1) {
    if (!domainMask[idx]) {
      continue;
    }
    const { x, y, z } = decodeIndex(grid, idx);

    let acc = src[idx];
    let count = 1;

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
        continue;
      }
      const nIdx = index3D(grid, nx, ny, nz);
      if (!domainMask[nIdx]) {
        continue;
      }
      acc += src[nIdx];
      count += 1;
    }

    const avg = acc / count;
    out[idx] = src[idx] * (1 - blend) + avg * blend;
  }

  return out;
}

function thresholdForVolume(
  values: Float32Array,
  domainMask: Uint8Array,
  preserveMask: Uint8Array,
  keepFraction: number
): number {
  const bins = 256;
  const hist = new Uint32Array(bins);
  let total = 0;

  for (let i = 0; i < values.length; i += 1) {
    if (!domainMask[i] || preserveMask[i]) {
      continue;
    }
    const v = clamp01(values[i]);
    const bin = Math.min(bins - 1, Math.floor(v * (bins - 1)));
    hist[bin] += 1;
    total += 1;
  }

  if (total === 0) {
    return 0.5;
  }

  const targetKeep = Math.round(total * clamp01(keepFraction));
  let accum = 0;

  for (let b = bins - 1; b >= 0; b -= 1) {
    accum += hist[b];
    if (accum >= targetKeep) {
      return b / (bins - 1);
    }
  }

  return 0.5;
}

function enforceThickness(
  occupancy: Uint8Array,
  domainMask: Uint8Array,
  preserveMask: Uint8Array,
  grid: VoxelGrid,
  minThickness: number
): Uint8Array {
  if (minThickness <= 0) {
    const out = occupancy.slice();
    for (let i = 0; i < out.length; i += 1) {
      if (preserveMask[i]) {
        out[i] = 1;
      }
      if (!domainMask[i]) {
        out[i] = 0;
      }
    }
    return out;
  }

  let shaped = occupancy.slice();
  shaped = dilateMask(shaped, grid, minThickness);
  shaped = erodeMask(shaped, grid, minThickness);

  for (let i = 0; i < shaped.length; i += 1) {
    if (!domainMask[i]) {
      shaped[i] = 0;
      continue;
    }
    if (preserveMask[i]) {
      shaped[i] = 1;
    }
  }

  return shaped;
}

export function solveDensityField({
  grid,
  domainMask,
  preserveMask,
  influence,
  targetVolumeFraction,
  iterations,
  smoothFactor,
  minThickness
}: DensitySolveArgs): DensitySolveResult {
  const rho = new Float32Array(influence.length);

  for (let i = 0; i < rho.length; i += 1) {
    if (!domainMask[i]) {
      continue;
    }
    rho[i] = preserveMask[i] ? 1 : clamp01(influence[i]);
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    const smoothed = neighborSmooth(rho, domainMask, grid, smoothFactor);
    const mixed = new Float32Array(rho.length);

    for (let i = 0; i < mixed.length; i += 1) {
      if (!domainMask[i]) {
        continue;
      }
      const m = smoothed[i] * 0.6 + influence[i] * 0.4;
      mixed[i] = clamp01(m);
    }

    const threshold = thresholdForVolume(mixed, domainMask, preserveMask, targetVolumeFraction);
    const beta = 2.4 + iter * 0.22;

    for (let i = 0; i < rho.length; i += 1) {
      if (!domainMask[i]) {
        rho[i] = 0;
        continue;
      }
      if (preserveMask[i]) {
        rho[i] = 1;
        continue;
      }
      const projected = 1 / (1 + Math.exp(-beta * (mixed[i] - threshold)));
      rho[i] = clamp01(rho[i] * 0.55 + projected * 0.45);
    }
  }

  const occupancy = new Uint8Array(rho.length);
  for (let i = 0; i < rho.length; i += 1) {
    if (domainMask[i] && (preserveMask[i] || rho[i] >= 0.52)) {
      occupancy[i] = 1;
    }
  }

  const thicknessEnforced = enforceThickness(occupancy, domainMask, preserveMask, grid, minThickness);

  let occupied = 0;
  let available = 0;
  for (let i = 0; i < thicknessEnforced.length; i += 1) {
    if (!domainMask[i] || preserveMask[i]) {
      continue;
    }
    available += 1;
    if (thicknessEnforced[i]) {
      occupied += 1;
      rho[i] = Math.max(rho[i], 0.56);
    } else {
      rho[i] = Math.min(rho[i], 0.49);
    }
  }

  for (let i = 0; i < rho.length; i += 1) {
    if (preserveMask[i]) {
      rho[i] = 1;
    }
  }

  return {
    density: rho,
    occupancy: thicknessEnforced,
    volumeFraction: available > 0 ? occupied / available : 0
  };
}
