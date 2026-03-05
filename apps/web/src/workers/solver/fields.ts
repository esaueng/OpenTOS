import { clamp01, index3D, normalizeVector, voxelCenter } from "./math";
import type { ForceVec, VariantParams, VoxelGrid } from "./types";

export interface InfluenceBaseFields {
  directional: Float32Array;
  connectivity: Float32Array;
  boundary: Float32Array;
}

function normalizeField(values: Float32Array, mask: Uint8Array): Float32Array {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < values.length; i += 1) {
    if (!mask[i]) {
      continue;
    }
    if (values[i] < min) {
      min = values[i];
    }
    if (values[i] > max) {
      max = values[i];
    }
  }

  const out = new Float32Array(values.length);
  const range = Math.max(max - min, 1e-9);

  for (let i = 0; i < values.length; i += 1) {
    if (!mask[i]) {
      continue;
    }
    out[i] = (values[i] - min) / range;
  }

  return out;
}

function diffuseField(field: Float32Array, domainMask: Uint8Array, grid: VoxelGrid, iterations: number): Float32Array {
  if (iterations <= 0) {
    return field;
  }

  const neighbors: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  let src = field;
  let dst = new Float32Array(field.length);

  for (let it = 0; it < iterations; it += 1) {
    dst.fill(0);
    for (let z = 0; z < grid.nz; z += 1) {
      for (let y = 0; y < grid.ny; y += 1) {
        for (let x = 0; x < grid.nx; x += 1) {
          const idx = index3D(grid, x, y, z);
          if (!domainMask[idx]) {
            continue;
          }

          let acc = src[idx] * 2.5;
          let count = 2.5;

          for (const [dx, dy, dz] of neighbors) {
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

          dst[idx] = acc / count;
        }
      }
    }

    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

export function normalizeForces(forces: ForceVec[]): ForceVec[] {
  return forces.map((force) => ({
    ...force,
    direction: normalizeVector(force.direction)
  }));
}

export function computeBaseInfluenceFields(
  grid: VoxelGrid,
  domainMask: Uint8Array,
  preservedDistance: Float32Array,
  forceDistance: Float32Array,
  forces: ForceVec[],
  connectivityIterations: number
): InfluenceBaseFields {
  const directionalRaw = new Float32Array(grid.total);
  const boundaryRaw = new Float32Array(grid.total);
  const connectivityRaw = new Float32Array(grid.total);

  const diagonal = grid.step * Math.hypot(grid.nx, grid.ny, grid.nz);
  const sigmaAxial = Math.max(diagonal * 0.35, grid.step * 4);
  const sigmaRadial = Math.max(diagonal * 0.12, grid.step * 2.25);
  const connScale = Math.max(diagonal * 0.8, grid.step * 4);
  const boundaryScale = Math.max(diagonal * 0.16, grid.step * 2);

  const normalizedForces = normalizeForces(forces);

  for (let z = 0; z < grid.nz; z += 1) {
    for (let y = 0; y < grid.ny; y += 1) {
      for (let x = 0; x < grid.nx; x += 1) {
        const idx = index3D(grid, x, y, z);
        if (!domainMask[idx]) {
          continue;
        }

        const c = voxelCenter(grid, x, y, z);
        let score = 0;

        for (const force of normalizedForces) {
          const dx = c[0] - force.point[0];
          const dy = c[1] - force.point[1];
          const dz = c[2] - force.point[2];

          const along = dx * force.direction[0] + dy * force.direction[1] + dz * force.direction[2];
          const dist2 = dx * dx + dy * dy + dz * dz;
          const perp2 = Math.max(0, dist2 - along * along);

          const forward = Math.exp(-(along * along) / (2 * sigmaAxial * sigmaAxial));
          const radial = Math.exp(-perp2 / (2 * sigmaRadial * sigmaRadial));
          const directionalBias = along >= 0 ? 1 : 0.72;
          score += force.magnitudeN * forward * radial * directionalBias;
        }

        directionalRaw[idx] = score;

        const dPres = preservedDistance[idx] * grid.step;
        boundaryRaw[idx] = Math.exp(-dPres / boundaryScale);

        const dForce = forceDistance[idx] * grid.step;
        const connect = Math.exp(-(dForce + dPres) / connScale);
        connectivityRaw[idx] = connect;
      }
    }
  }

  const directional = normalizeField(directionalRaw, domainMask);
  const boundary = normalizeField(boundaryRaw, domainMask);
  const connectivitySmoothed = diffuseField(
    normalizeField(connectivityRaw, domainMask),
    domainMask,
    grid,
    connectivityIterations
  );
  const connectivity = normalizeField(connectivitySmoothed, domainMask);

  return {
    directional,
    connectivity,
    boundary
  };
}

export function combineInfluenceFields(
  base: InfluenceBaseFields,
  domainMask: Uint8Array,
  variant: VariantParams,
  targetSafetyFactor: number
): Float32Array {
  const out = new Float32Array(base.directional.length);
  const safetyBias = 1 + Math.max(0, targetSafetyFactor - 1) * 0.075;

  for (let i = 0; i < out.length; i += 1) {
    if (!domainMask[i]) {
      continue;
    }

    const directional = base.directional[i];
    const connectivity = base.connectivity[i];
    const boundary = base.boundary[i];

    const composite =
      directional * variant.directionWeight +
      connectivity * variant.connectivityWeight +
      boundary * variant.boundaryWeight;

    const rib = Math.sqrt(Math.max(0, directional * connectivity));
    out[i] = clamp01((composite + rib * variant.ribBoost) * safetyBias);
  }

  return out;
}
