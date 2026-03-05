import { clamp01, decodeIndex, index3D } from "./math";
import type { DensitySolveResult, VoxelGrid } from "./types";
import { dilateMask, erodeMask } from "./voxel";

interface DensitySolveArgs {
  grid: VoxelGrid;
  domainMask: Uint8Array;
  preserveMask: Uint8Array;
  anchorMask: Uint8Array;
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

function smoothDensityField(src: Float32Array, domainMask: Uint8Array, grid: VoxelGrid, iterations: number): Float32Array {
  let field = src;
  for (let i = 0; i < iterations; i += 1) {
    field = neighborSmooth(field, domainMask, grid, 0.46);
  }
  return field;
}

function carveInteriorVoids(
  occupancy: Uint8Array,
  influence: Float32Array,
  domainMask: Uint8Array,
  preserveMask: Uint8Array,
  grid: VoxelGrid,
  aggressiveness: number
): Uint8Array {
  const carved = occupancy.slice();
  const passes = Math.max(1, Math.min(3, Math.round(1 + aggressiveness * 2)));

  for (let pass = 0; pass < passes; pass += 1) {
    const next = carved.slice();
    const threshold = 0.34 + aggressiveness * 0.22 + pass * 0.04;

    for (let idx = 0; idx < carved.length; idx += 1) {
      if (!carved[idx] || !domainMask[idx] || preserveMask[idx]) {
        continue;
      }

      const { x, y, z } = decodeIndex(grid, idx);
      let neighborCount = 0;
      let occupiedCount = 0;

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
        neighborCount += 1;
        if (carved[nIdx]) {
          occupiedCount += 1;
        }
      }

      const fullyInterior = neighborCount >= 5 && occupiedCount >= neighborCount;
      if (!fullyInterior) {
        continue;
      }

      if (influence[idx] < threshold) {
        next[idx] = 0;
      }
    }

    carved.set(next);
  }

  return carved;
}

function retainConnectedToAnchors(
  occupancy: Uint8Array,
  domainMask: Uint8Array,
  preserveMask: Uint8Array,
  anchorMask: Uint8Array,
  grid: VoxelGrid
): Uint8Array {
  const kept = new Uint8Array(occupancy.length);
  const visited = new Uint8Array(occupancy.length);
  const queue = new Int32Array(occupancy.length);
  let head = 0;
  let tail = 0;

  const enqueue = (idx: number): void => {
    if (visited[idx] || !occupancy[idx] || !domainMask[idx]) {
      return;
    }
    visited[idx] = 1;
    kept[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  for (let i = 0; i < anchorMask.length; i += 1) {
    if (anchorMask[i]) {
      enqueue(i);
    }
  }

  for (let i = 0; i < preserveMask.length; i += 1) {
    if (preserveMask[i]) {
      enqueue(i);
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const { x, y, z } = decodeIndex(grid, idx);

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
        continue;
      }
      enqueue(index3D(grid, nx, ny, nz));
    }
  }

  for (let i = 0; i < kept.length; i += 1) {
    if (preserveMask[i]) {
      kept[i] = 1;
    }
  }

  return kept;
}

export function solveDensityField({
  grid,
  domainMask,
  preserveMask,
  anchorMask,
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

  const carveAggressiveness = clamp01((0.38 - targetVolumeFraction) * 3.2);
  const carved = carveInteriorVoids(occupancy, influence, domainMask, preserveMask, grid, carveAggressiveness);
  const anchored = retainConnectedToAnchors(carved, domainMask, preserveMask, anchorMask, grid);
  const thicknessEnforced = enforceThickness(anchored, domainMask, preserveMask, grid, minThickness);
  const finalOccupancy = retainConnectedToAnchors(thicknessEnforced, domainMask, preserveMask, anchorMask, grid);
  const densitySmoothed = smoothDensityField(rho, domainMask, grid, 2);

  let occupied = 0;
  let available = 0;
  for (let i = 0; i < finalOccupancy.length; i += 1) {
    if (!domainMask[i] || preserveMask[i]) {
      continue;
    }
    available += 1;
    if (finalOccupancy[i]) {
      occupied += 1;
      densitySmoothed[i] = Math.max(densitySmoothed[i], 0.58);
    } else {
      densitySmoothed[i] = Math.min(densitySmoothed[i], 0.45);
    }
  }

  for (let i = 0; i < densitySmoothed.length; i += 1) {
    if (preserveMask[i]) {
      densitySmoothed[i] = 1;
    }
  }

  return {
    density: densitySmoothed,
    occupancy: finalOccupancy,
    volumeFraction: available > 0 ? occupied / available : 0
  };
}
