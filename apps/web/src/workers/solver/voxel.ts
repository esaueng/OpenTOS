import { faceCountFromPositions, faceCenter } from "./geometry";
import { clamp, decodeIndex, index3D, voxelCenter } from "./math";
import type { VoxelGrid } from "./types";

export interface DomainVoxelization {
  domainMask: Uint8Array;
  surfaceMask: Uint8Array;
}

const NEIGHBOR_OFFSETS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function pointTriangleDistanceSquared(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    return apx * apx + apy * apy + apz * apz;
  }

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return bpx * bpx + bpy * bpy + bpz * bpz;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = ax + v * abx;
    const qy = ay + v * aby;
    const qz = az + v * abz;
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return cpx * cpx + cpy * cpy + cpz * cpz;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx;
    const qy = ay + w * acy;
    const qz = az + w * acz;
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bx + w * (cx - bx);
    const qy = by + w * (cy - by);
    const qz = bz + w * (cz - bz);
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = ax + abx * v + acx * w;
  const qy = ay + aby * v + acy * w;
  const qz = az + abz * v + acz * w;

  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

function rasterizeFacesToSurface(
  positions: Float32Array,
  faceIndices: number[],
  grid: VoxelGrid,
  thickness: number
): Uint8Array {
  const mask = new Uint8Array(grid.total);
  const threshold2 = thickness * thickness;

  for (const faceIdx of faceIndices) {
    const i = faceIdx * 9;
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];

    const minX = clamp(Math.floor((Math.min(ax, bx, cx) - grid.origin[0]) / grid.step) - 1, 0, grid.nx - 1);
    const maxX = clamp(Math.ceil((Math.max(ax, bx, cx) - grid.origin[0]) / grid.step) + 1, 0, grid.nx - 1);
    const minY = clamp(Math.floor((Math.min(ay, by, cy) - grid.origin[1]) / grid.step) - 1, 0, grid.ny - 1);
    const maxY = clamp(Math.ceil((Math.max(ay, by, cy) - grid.origin[1]) / grid.step) + 1, 0, grid.ny - 1);
    const minZ = clamp(Math.floor((Math.min(az, bz, cz) - grid.origin[2]) / grid.step) - 1, 0, grid.nz - 1);
    const maxZ = clamp(Math.ceil((Math.max(az, bz, cz) - grid.origin[2]) / grid.step) + 1, 0, grid.nz - 1);

    for (let z = minZ; z <= maxZ; z += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const [px, py, pz] = voxelCenter(grid, x, y, z);
          const d2 = pointTriangleDistanceSquared(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (d2 <= threshold2) {
            mask[index3D(grid, x, y, z)] = 1;
          }
        }
      }
    }
  }

  return mask;
}

export function dilateMask(mask: Uint8Array, grid: VoxelGrid, iterations: number): Uint8Array {
  let src = mask;
  let dst = new Uint8Array(mask.length);

  for (let it = 0; it < iterations; it += 1) {
    dst.fill(0);
    for (let idx = 0; idx < grid.total; idx += 1) {
      if (src[idx]) {
        dst[idx] = 1;
        const { x, y, z } = decodeIndex(grid, idx);
        for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
            continue;
          }
          dst[index3D(grid, nx, ny, nz)] = 1;
        }
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

export function erodeMask(mask: Uint8Array, grid: VoxelGrid, iterations: number): Uint8Array {
  let src = mask;
  let dst = new Uint8Array(mask.length);

  for (let it = 0; it < iterations; it += 1) {
    dst.fill(0);
    for (let idx = 0; idx < grid.total; idx += 1) {
      if (!src[idx]) {
        continue;
      }
      const { x, y, z } = decodeIndex(grid, idx);
      let keep = true;
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
          keep = false;
          break;
        }
        if (!src[index3D(grid, nx, ny, nz)]) {
          keep = false;
          break;
        }
      }
      if (keep) {
        dst[idx] = 1;
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

function floodFillOutside(surfaceMask: Uint8Array, grid: VoxelGrid): Uint8Array {
  const outside = new Uint8Array(grid.total);
  const queue = new Int32Array(grid.total);
  let head = 0;
  let tail = 0;

  const enqueue = (idx: number): void => {
    if (outside[idx] || surfaceMask[idx]) {
      return;
    }
    outside[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  for (let x = 0; x < grid.nx; x += 1) {
    for (let y = 0; y < grid.ny; y += 1) {
      enqueue(index3D(grid, x, y, 0));
      enqueue(index3D(grid, x, y, grid.nz - 1));
    }
  }
  for (let x = 0; x < grid.nx; x += 1) {
    for (let z = 0; z < grid.nz; z += 1) {
      enqueue(index3D(grid, x, 0, z));
      enqueue(index3D(grid, x, grid.ny - 1, z));
    }
  }
  for (let y = 0; y < grid.ny; y += 1) {
    for (let z = 0; z < grid.nz; z += 1) {
      enqueue(index3D(grid, 0, y, z));
      enqueue(index3D(grid, grid.nx - 1, y, z));
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const { x, y, z } = decodeIndex(grid, idx);

    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
        continue;
      }
      const next = index3D(grid, nx, ny, nz);
      if (!outside[next] && !surfaceMask[next]) {
        outside[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
  }

  return outside;
}

export function voxelizeDomain(positions: Float32Array, grid: VoxelGrid): DomainVoxelization {
  const faces = Array.from({ length: faceCountFromPositions(positions) }, (_, i) => i);
  let surfaceMask = rasterizeFacesToSurface(positions, faces, grid, grid.step * 0.75);
  surfaceMask = dilateMask(surfaceMask, grid, 1);

  const outside = floodFillOutside(surfaceMask, grid);
  const domainMask = new Uint8Array(grid.total);
  let interiorCount = 0;

  for (let i = 0; i < grid.total; i += 1) {
    const filled = outside[i] ? 0 : 1;
    domainMask[i] = filled;
    if (filled) {
      interiorCount += 1;
    }
  }

  if (interiorCount < grid.total * 0.004) {
    const fallback = dilateMask(surfaceMask, grid, 3);
    const closed = erodeMask(fallback, grid, 1);
    domainMask.set(closed);
  }

  return { domainMask, surfaceMask };
}

export function rasterizePreservedMask(
  positions: Float32Array,
  preservedFaces: Set<number>,
  grid: VoxelGrid,
  shellThickness: number
): Uint8Array {
  const faces = Array.from(preservedFaces);
  if (faces.length === 0) {
    return new Uint8Array(grid.total);
  }
  const surface = rasterizeFacesToSurface(positions, faces, grid, shellThickness);
  return dilateMask(surface, grid, 1);
}

export function distanceFromMask(mask: Uint8Array, domainMask: Uint8Array, grid: VoxelGrid): Float32Array {
  const dist = new Float32Array(grid.total);
  dist.fill(Number.POSITIVE_INFINITY);

  const queue = new Int32Array(grid.total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < grid.total; i += 1) {
    if (mask[i] && domainMask[i]) {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDistance = dist[idx] + 1;
    const { x, y, z } = decodeIndex(grid, idx);

    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
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
      if (nextDistance < dist[nIdx]) {
        dist[nIdx] = nextDistance;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
  }

  return dist;
}

export function forceSeedMask(
  forces: { point: [number, number, number]; direction?: [number, number, number]; magnitudeN?: number }[],
  domainMask: Uint8Array,
  grid: VoxelGrid
): Uint8Array {
  const mask = new Uint8Array(grid.total);
  const stampSeed = (idx: number, radius: number): void => {
    const { x, y, z } = decodeIndex(grid, idx);
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
            continue;
          }
          const nIdx = index3D(grid, nx, ny, nz);
          if (domainMask[nIdx]) {
            mask[nIdx] = 1;
          }
        }
      }
    }
  };

  for (const force of forces) {
    const x = clamp(Math.floor((force.point[0] - grid.origin[0]) / grid.step), 0, grid.nx - 1);
    const y = clamp(Math.floor((force.point[1] - grid.origin[1]) / grid.step), 0, grid.ny - 1);
    const z = clamp(Math.floor((force.point[2] - grid.origin[2]) / grid.step), 0, grid.nz - 1);
    const idx = index3D(grid, x, y, z);
    const baseRadius = Math.max(1, Math.min(2, Math.round(Math.sqrt(Math.max(force.magnitudeN ?? 1, 1)) / 40)));
    if (domainMask[idx]) {
      stampSeed(idx, baseRadius);
    } else {
      // Snap to nearest domain voxel by local search.
      let best = -1;
      let bestDist2 = Number.POSITIVE_INFINITY;
      const radius = 4;
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
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
            const c = voxelCenter(grid, nx, ny, nz);
            const cx = c[0] - force.point[0];
            const cy = c[1] - force.point[1];
            const cz = c[2] - force.point[2];
            const d2 = cx * cx + cy * cy + cz * cz;
            if (d2 < bestDist2) {
              bestDist2 = d2;
              best = nIdx;
            }
          }
        }
      }

      if (best >= 0) {
        stampSeed(best, baseRadius);
      }
    }

    if (force.direction) {
      const length = Math.hypot(force.direction[0], force.direction[1], force.direction[2]);
      if (length > 1e-9) {
        const direction = [force.direction[0] / length, force.direction[1] / length, force.direction[2] / length] as const;
        const steps = Math.max(1, baseRadius + 1);
        for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
          const samplePoint: [number, number, number] = [
            force.point[0] - direction[0] * grid.step * stepIndex,
            force.point[1] - direction[1] * grid.step * stepIndex,
            force.point[2] - direction[2] * grid.step * stepIndex
          ];
          const sx = clamp(Math.floor((samplePoint[0] - grid.origin[0]) / grid.step), 0, grid.nx - 1);
          const sy = clamp(Math.floor((samplePoint[1] - grid.origin[1]) / grid.step), 0, grid.ny - 1);
          const sz = clamp(Math.floor((samplePoint[2] - grid.origin[2]) / grid.step), 0, grid.nz - 1);
          const sIdx = index3D(grid, sx, sy, sz);
          if (domainMask[sIdx]) {
            stampSeed(sIdx, Math.max(1, baseRadius - 1));
          }
        }
      }
    }
  }
  return mask;
}

export function regionCenterMask(
  regionFaces: number[][],
  positions: Float32Array,
  domainMask: Uint8Array,
  grid: VoxelGrid
): Uint8Array {
  const mask = new Uint8Array(grid.total);
  for (const group of regionFaces) {
    if (!group.length) {
      continue;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const faceIdx of group) {
      const c = faceCenter(positions, faceIdx);
      sx += c[0];
      sy += c[1];
      sz += c[2];
    }
    const inv = 1 / group.length;
    const x = clamp(Math.floor((sx * inv - grid.origin[0]) / grid.step), 0, grid.nx - 1);
    const y = clamp(Math.floor((sy * inv - grid.origin[1]) / grid.step), 0, grid.ny - 1);
    const z = clamp(Math.floor((sz * inv - grid.origin[2]) / grid.step), 0, grid.nz - 1);

    const idx = index3D(grid, x, y, z);
    if (domainMask[idx]) {
      mask[idx] = 1;
    }
  }
  return mask;
}
