import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { index3D } from "./math";
import type { VoxelGrid } from "./types";

const TETRA_FROM_CUBE: [number, number, number, number][] = [
  [0, 5, 1, 6],
  [0, 5, 6, 4],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 6, 7, 3],
  [0, 4, 6, 7]
];

const CUBE_CORNER_OFFSETS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1]
];

const TET_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3]
];

function taubinSmoothIndexed(geometry: THREE.BufferGeometry, iterations: number): void {
  const index = geometry.getIndex();
  const posAttr = geometry.getAttribute("position");
  if (!index || !posAttr || posAttr.itemSize !== 3) {
    return;
  }

  const positions = posAttr.array as Float32Array;
  const vertexCount = posAttr.count;
  const neighbors: number[][] = Array.from({ length: vertexCount }, () => []);

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    neighbors[a].push(b, c);
    neighbors[b].push(a, c);
    neighbors[c].push(a, b);
  }

  const lambda = 0.45;
  const mu = -0.47;

  const smoothPass = (weight: number): void => {
    const next = new Float32Array(positions.length);
    for (let vi = 0; vi < vertexCount; vi += 1) {
      const base = vi * 3;
      const n = neighbors[vi];
      if (n.length === 0) {
        next[base] = positions[base];
        next[base + 1] = positions[base + 1];
        next[base + 2] = positions[base + 2];
        continue;
      }

      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const ni of n) {
        const nb = ni * 3;
        sx += positions[nb];
        sy += positions[nb + 1];
        sz += positions[nb + 2];
      }

      const inv = 1 / n.length;
      const ax = sx * inv;
      const ay = sy * inv;
      const az = sz * inv;

      next[base] = positions[base] + (ax - positions[base]) * weight;
      next[base + 1] = positions[base + 1] + (ay - positions[base + 1]) * weight;
      next[base + 2] = positions[base + 2] + (az - positions[base + 2]) * weight;
    }

    positions.set(next);
  };

  for (let it = 0; it < iterations; it += 1) {
    smoothPass(lambda);
    smoothPass(mu);
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

function interpolatePoint(
  iso: number,
  p0: [number, number, number],
  p1: [number, number, number],
  v0: number,
  v1: number
): [number, number, number] {
  if (Math.abs(v1 - v0) <= 1e-9) {
    return [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5, (p0[2] + p1[2]) * 0.5];
  }
  const t = (iso - v0) / (v1 - v0);
  return [
    p0[0] + (p1[0] - p0[0]) * t,
    p0[1] + (p1[1] - p0[1]) * t,
    p0[2] + (p1[2] - p0[2]) * t
  ];
}

export function extractIsoSurface(
  grid: VoxelGrid,
  density: Float32Array,
  domainMask: Uint8Array,
  isoLevel: number,
  taubinIterations: number
): THREE.BufferGeometry {
  const triangles: number[] = [];

  for (let z = 0; z < grid.nz - 1; z += 1) {
    for (let y = 0; y < grid.ny - 1; y += 1) {
      for (let x = 0; x < grid.nx - 1; x += 1) {
        const cornerScalars = new Float32Array(8);
        const cornerPoints: [number, number, number][] = Array.from({ length: 8 }, () => [0, 0, 0]);

        let minV = Number.POSITIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;

        for (let c = 0; c < 8; c += 1) {
          const o = CUBE_CORNER_OFFSETS[c];
          const cx = x + o[0];
          const cy = y + o[1];
          const cz = z + o[2];
          const idx = index3D(grid, cx, cy, cz);
          const scalar = domainMask[idx] ? density[idx] : 0;
          cornerScalars[c] = scalar;
          cornerPoints[c] = [
            grid.origin[0] + (cx + 0.5) * grid.step,
            grid.origin[1] + (cy + 0.5) * grid.step,
            grid.origin[2] + (cz + 0.5) * grid.step
          ];
          if (scalar < minV) minV = scalar;
          if (scalar > maxV) maxV = scalar;
        }

        if (minV > isoLevel || maxV < isoLevel) {
          continue;
        }

        for (const [aIdx, bIdx, cIdx, dIdx] of TETRA_FROM_CUBE) {
          const ids = [aIdx, bIdx, cIdx, dIdx] as const;
          const values = [cornerScalars[aIdx], cornerScalars[bIdx], cornerScalars[cIdx], cornerScalars[dIdx]];
          const points = [cornerPoints[aIdx], cornerPoints[bIdx], cornerPoints[cIdx], cornerPoints[dIdx]];

          let insideCount = 0;
          for (let i = 0; i < 4; i += 1) {
            if (values[i] >= isoLevel) {
              insideCount += 1;
            }
          }
          if (insideCount === 0 || insideCount === 4) {
            continue;
          }

          const intersections: [number, number, number][] = [];
          for (const [u, v] of TET_EDGES) {
            const vu = values[u];
            const vv = values[v];
            if ((vu >= isoLevel && vv >= isoLevel) || (vu < isoLevel && vv < isoLevel)) {
              continue;
            }
            intersections.push(interpolatePoint(isoLevel, points[u], points[v], vu, vv));
          }

          if (intersections.length < 3) {
            continue;
          }

          if (intersections.length === 3) {
            for (const p of intersections) {
              triangles.push(p[0], p[1], p[2]);
            }
            continue;
          }

          if (intersections.length === 4) {
            const [p0, p1, p2, p3] = intersections;
            triangles.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
            triangles.push(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
          }
        }
      }
    }
  }

  if (triangles.length === 0) {
    const fallback = new THREE.SphereGeometry(grid.step * 1.5, 12, 8);
    fallback.computeVertexNormals();
    return fallback.toNonIndexed();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(triangles), 3));
  const welded = BufferGeometryUtils.mergeVertices(geometry, grid.step * 0.15);
  welded.computeVertexNormals();
  taubinSmoothIndexed(welded, taubinIterations);
  return welded;
}

export function makePreservedGeometry(positions: Float32Array, preservedFaces: Set<number>): THREE.BufferGeometry {
  const faceList = Array.from(preservedFaces.values()).sort((a, b) => a - b);
  const preserved = new Float32Array(faceList.length * 9);
  let cursor = 0;

  for (const faceIdx of faceList) {
    const src = faceIdx * 9;
    preserved[cursor] = positions[src];
    preserved[cursor + 1] = positions[src + 1];
    preserved[cursor + 2] = positions[src + 2];
    preserved[cursor + 3] = positions[src + 3];
    preserved[cursor + 4] = positions[src + 4];
    preserved[cursor + 5] = positions[src + 5];
    preserved[cursor + 6] = positions[src + 6];
    preserved[cursor + 7] = positions[src + 7];
    preserved[cursor + 8] = positions[src + 8];
    cursor += 9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(preserved, 3));
  geometry.computeVertexNormals();
  return geometry;
}
