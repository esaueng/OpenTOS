/// <reference lib="webworker" />

import type { OutcomeV2, StudyCreateRequest } from "@contracts/index";

import { resolveQualityProfile } from "./solver/config";
import {
  buildVoxelGrid,
  computeBoundingBox,
  estimateSolverMemoryBytes,
  faceCountFromPositions,
  faceCenter,
  getFaceSet,
  getPreservedData
} from "./solver/geometry";
import { combineInfluenceFields, computeBaseInfluenceFields } from "./solver/fields";
import { exportOutcomeGlb } from "./solver/export";
import { clamp01 } from "./solver/math";
import { extractIsoSurface, makePreservedGeometry } from "./solver/mesh";
import { computeOutcomeMetrics, geometryVolume } from "./solver/metrics";
import { solveDensityField } from "./solver/optimize";
import type {
  BrowserQualityProfile,
  ForceVec,
  PreservedTarget,
  WorkerInMessage,
  WorkerOutMessage,
  WorkerStage,
  WorkerStatus
} from "./solver/types";
import { computeSignature, isUniqueVariant, variantParams } from "./solver/variants";
import {
  dilateMask,
  distanceFromMask,
  erodeMask,
  forceSeedMask,
  rasterizePreservedMask,
  voxelizeDomain
} from "./solver/voxel";

const FORCE_TO_NEWTONS: Record<"N" | "lb", number> = {
  N: 1,
  lb: 4.4482216152605
};

type ProgressArgs = {
  stage: WorkerStage;
  progress: number;
  status: WorkerStatus;
  qualityProfile: BrowserQualityProfile;
  warnings: string[];
  etaSeconds?: number;
};

type SolverTarget = PreservedTarget & {
  groupId: number;
  role: "center" | "anchor";
};

type InterfaceProfile = {
  groupId: number;
  center: [number, number, number];
  axis: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  radiusU: number;
  radiusV: number;
  weight: number;
};

function postMessageTyped(message: WorkerOutMessage): void {
  self.postMessage(message);
}

function postProgress(args: ProgressArgs): void {
  postMessageTyped({
    type: "progress",
    stage: args.stage,
    progress: clamp01(args.progress),
    status: args.status,
    qualityProfile: args.qualityProfile,
    warnings: args.warnings,
    etaSeconds: args.etaSeconds
  });
}

function normalizeForces(request: StudyCreateRequest): ForceVec[] {
  const all: ForceVec[] = [];
  for (const loadCase of request.loadCases) {
    for (const force of loadCase.forces) {
      const [dx, dy, dz] = force.direction;
      const len = Math.hypot(dx, dy, dz);
      const direction: [number, number, number] =
        len <= 1e-12 ? [0, 0, 1] : [dx / len, dy / len, dz / len];

      all.push({
        point: [force.point[0], force.point[1], force.point[2]],
        direction,
        magnitudeN: force.magnitude * FORCE_TO_NEWTONS[force.unit]
      });
    }
  }
  return all;
}

function fixedFacesFromLoadCases(request: StudyCreateRequest): Set<number> {
  const byId = new Map<string, number[]>();
  for (const region of request.preservedRegions) {
    byId.set(region.id, region.faceIndices);
  }

  const fixed = new Set<number>();
  for (const loadCase of request.loadCases) {
    for (const fixedRegionId of loadCase.fixedRegions) {
      const faces = byId.get(fixedRegionId);
      if (!faces) {
        continue;
      }
      for (const face of faces) {
        fixed.add(face);
      }
    }
  }
  return fixed;
}

function baselineVolumeFromPositions(positions: Float32Array): number {
  const g = makePreservedGeometry(
    positions,
    new Set(Array.from({ length: faceCountFromPositions(positions) }, (_, i) => i))
  );
  const volume = geometryVolume(g);
  g.dispose();
  return volume;
}

function outcomeRankScore(
  outcome: OutcomeV2,
  targetSafetyFactor: number,
  targetMassReductionPct: number
): number {
  const safetyShortfall = Math.max(0, targetSafetyFactor - outcome.metrics.safetyIndexProxy);
  const massGap = Math.abs(targetMassReductionPct - outcome.metrics.massReductionPct);
  return (
    outcome.metrics.complianceProxy * 0.55 +
    outcome.metrics.stressProxy * 0.18 +
    outcome.metrics.displacementProxy * 0.14 +
    safetyShortfall * 28 +
    massGap * 0.24 -
    Math.min(outcome.metrics.massReductionPct, targetMassReductionPct) * 0.08
  );
}

function pointDistanceSquared(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length3(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize3(v: [number, number, number], fallback: [number, number, number] = [0, 0, 1]): [number, number, number] {
  const len = length3(v);
  if (len <= 1e-9) {
    return [...fallback];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function subtract3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled3(
  base: [number, number, number],
  dir: [number, number, number],
  scale: number
): [number, number, number] {
  return [base[0] + dir[0] * scale, base[1] + dir[1] * scale, base[2] + dir[2] * scale];
}

function projectOntoPlane(
  v: [number, number, number],
  normal: [number, number, number]
): [number, number, number] {
  const d = dot3(v, normal);
  return [v[0] - normal[0] * d, v[1] - normal[1] * d, v[2] - normal[2] * d];
}

function orthonormalFallback(axis: [number, number, number]): {
  u: [number, number, number];
  v: [number, number, number];
} {
  const ref: [number, number, number] = Math.abs(axis[2]) < 0.82 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize3(cross3(ref, axis), [1, 0, 0]);
  const v = normalize3(cross3(axis, u), [0, 1, 0]);
  return { u, v };
}

function jacobiEigenSymmetric3(matrix: number[][]): {
  values: [number, number, number];
  vectors: [[number, number, number], [number, number, number], [number, number, number]];
} {
  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  for (let iter = 0; iter < 16; iter += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) {
      p = 0;
      q = 2;
      max = Math.abs(a[0][2]);
    }
    if (Math.abs(a[1][2]) > max) {
      p = 1;
      q = 2;
      max = Math.abs(a[1][2]);
    }
    if (max <= 1e-10) {
      break;
    }

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let r = 0; r < 3; r += 1) {
      if (r !== p && r !== q) {
        const arp = a[r][p];
        const arq = a[r][q];
        a[r][p] = arp * c - arq * s;
        a[p][r] = a[r][p];
        a[r][q] = arq * c + arp * s;
        a[q][r] = a[r][q];
      }
    }

    a[p][p] = app * c * c - 2 * apq * s * c + aqq * s * s;
    a[q][q] = aqq * c * c + 2 * apq * s * c + app * s * s;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < 3; r += 1) {
      const vrp = v[r][p];
      const vrq = v[r][q];
      v[r][p] = vrp * c - vrq * s;
      v[r][q] = vrq * c + vrp * s;
    }
  }

  const eig = [
    { value: a[0][0], vector: normalize3([v[0][0], v[1][0], v[2][0]], [1, 0, 0]) },
    { value: a[1][1], vector: normalize3([v[0][1], v[1][1], v[2][1]], [0, 1, 0]) },
    { value: a[2][2], vector: normalize3([v[0][2], v[1][2], v[2][2]], [0, 0, 1]) }
  ].sort((left, right) => left.value - right.value);

  return {
    values: [eig[0].value, eig[1].value, eig[2].value],
    vectors: [eig[0].vector, eig[1].vector, eig[2].vector]
  };
}

function buildInterfaceProfiles(positions: Float32Array, groups: number[][]): InterfaceProfile[] {
  return groups
    .map((group, groupId) => {
      if (!group.length) {
        return null;
      }

      const samples: Array<[number, number, number]> = [];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const faceIndex of group) {
        const center = faceCenter(positions, faceIndex);
        samples.push(center);
        sx += center[0];
        sy += center[1];
        sz += center[2];
      }

      const inv = 1 / samples.length;
      const center: [number, number, number] = [sx * inv, sy * inv, sz * inv];

      let cxx = 0;
      let cxy = 0;
      let cxz = 0;
      let cyy = 0;
      let cyz = 0;
      let czz = 0;
      for (const sample of samples) {
        const dx = sample[0] - center[0];
        const dy = sample[1] - center[1];
        const dz = sample[2] - center[2];
        cxx += dx * dx;
        cxy += dx * dy;
        cxz += dx * dz;
        cyy += dy * dy;
        cyz += dy * dz;
        czz += dz * dz;
      }
      const covariance = [
        [cxx * inv, cxy * inv, cxz * inv],
        [cxy * inv, cyy * inv, cyz * inv],
        [cxz * inv, cyz * inv, czz * inv]
      ];
      const eig = jacobiEigenSymmetric3(covariance);
      const axis = normalize3(eig.vectors[0], [0, 0, 1]);
      let u = normalize3(eig.vectors[2], [1, 0, 0]);
      let v = normalize3(eig.vectors[1], [0, 1, 0]);
      if (length3(cross3(u, v)) <= 1e-6) {
        const fallback = orthonormalFallback(axis);
        u = fallback.u;
        v = fallback.v;
      }
      if (dot3(cross3(u, v), axis) < 0) {
        v = [-v[0], -v[1], -v[2]];
      }

      let radiusU = 0;
      let radiusV = 0;
      for (const sample of samples) {
        const delta = subtract3(sample, center);
        radiusU = Math.max(radiusU, Math.abs(dot3(delta, u)));
        radiusV = Math.max(radiusV, Math.abs(dot3(delta, v)));
      }

      const fallbackRadius = Math.max(radiusU, radiusV, 1e-3);
      return {
        groupId,
        center,
        axis,
        u,
        v,
        radiusU: Math.max(radiusU, fallbackRadius * 0.72),
        radiusV: Math.max(radiusV, fallbackRadius * 0.72),
        weight: Math.min(1.8, Math.max(0.6, Math.sqrt(group.length) * 0.14))
      };
    })
    .filter((value): value is InterfaceProfile => value !== null);
}

function buildSolverTargets(profiles: InterfaceProfile[]): SolverTarget[] {
  const targets: SolverTarget[] = [];
  for (const profile of profiles) {
    targets.push({
      point: profile.center,
      weight: profile.weight * 0.92,
      groupId: profile.groupId,
      role: "center"
    });

    const anchors: Array<{ dir: [number, number, number]; radius: number }> = [
      { dir: profile.u, radius: profile.radiusU },
      { dir: [-profile.u[0], -profile.u[1], -profile.u[2]], radius: profile.radiusU },
      { dir: profile.v, radius: profile.radiusV },
      { dir: [-profile.v[0], -profile.v[1], -profile.v[2]], radius: profile.radiusV }
    ];

    for (const anchor of anchors) {
      if (anchor.radius <= 1e-4) {
        continue;
      }
      targets.push({
        point: addScaled3(profile.center, anchor.dir, anchor.radius * 1.08),
        weight: profile.weight * 1.08,
        groupId: profile.groupId,
        role: "anchor"
      });
    }
  }

  return targets;
}

function distanceToSegmentSquared(
  point: [number, number, number],
  start: [number, number, number],
  end: [number, number, number]
): number {
  const sx = end[0] - start[0];
  const sy = end[1] - start[1];
  const sz = end[2] - start[2];
  const px = point[0] - start[0];
  const py = point[1] - start[1];
  const pz = point[2] - start[2];
  const segLen2 = Math.max(1e-9, sx * sx + sy * sy + sz * sz);
  const t = clamp01((px * sx + py * sy + pz * sz) / segLen2);
  const qx = start[0] + sx * t;
  const qy = start[1] + sy * t;
  const qz = start[2] + sz * t;
  return pointDistanceSquared(point, [qx, qy, qz]);
}

function buildTrussBoostField(
  grid: ReturnType<typeof buildVoxelGrid>,
  domainMask: Uint8Array,
  surfaceDistance: Float32Array,
  preservedTargets: SolverTarget[],
  forces: ForceVec[]
): Float32Array {
  const out = new Float32Array(grid.total);
  if (preservedTargets.length < 2) {
    return out;
  }

  const segments: Array<{ start: [number, number, number]; end: [number, number, number]; weight: number }> = [];
  const pairKeys = new Set<string>();
  for (let i = 0; i < preservedTargets.length; i += 1) {
    const nearest = preservedTargets
      .map((target, idx) => ({
        idx,
        dist2: idx === i ? Number.POSITIVE_INFINITY : pointDistanceSquared(preservedTargets[i].point, target.point)
      }))
      .filter((entry) => preservedTargets[entry.idx].groupId !== preservedTargets[i].groupId)
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, preservedTargets[i].role === "anchor" ? 2 : 1);
    for (const entry of nearest) {
      const left = Math.min(i, entry.idx);
      const right = Math.max(i, entry.idx);
      const key = `${left}:${right}`;
      if (pairKeys.has(key)) {
        continue;
      }
      pairKeys.add(key);
      segments.push({
        start: preservedTargets[left].point,
        end: preservedTargets[right].point,
        weight: Math.sqrt(Math.max(preservedTargets[left].weight * preservedTargets[right].weight, 0.25))
      });
    }
  }

  for (const force of forces) {
    const nearestTargets = preservedTargets
      .map((target) => ({ target, dist2: pointDistanceSquared(force.point, target.point) }))
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, Math.min(3, preservedTargets.length));
    for (const entry of nearestTargets) {
      segments.push({
        start: force.point,
        end: entry.target.point,
        weight: Math.max(0.75, Math.sqrt(entry.target.weight) * 0.95)
      });
    }
  }

  const sigma = Math.max(grid.step * 1.6, grid.step * (preservedTargets.length > 3 ? 1.5 : 1.8));
  const sigma2 = 2 * sigma * sigma;
  const nodeSigma2 = 2 * (sigma * 1.7) * (sigma * 1.7);

  for (let z = 0; z < grid.nz; z += 1) {
    for (let y = 0; y < grid.ny; y += 1) {
      for (let x = 0; x < grid.nx; x += 1) {
        const idx = x + grid.nx * (y + grid.ny * z);
        if (!domainMask[idx]) {
          continue;
        }
        const point = [
          grid.origin[0] + (x + 0.5) * grid.step,
          grid.origin[1] + (y + 0.5) * grid.step,
          grid.origin[2] + (z + 0.5) * grid.step
        ] as [number, number, number];

        let corridor = 0;
        for (const segment of segments) {
          const dist2 = distanceToSegmentSquared(point, segment.start, segment.end);
          corridor = Math.max(corridor, Math.exp(-dist2 / sigma2) * segment.weight);
        }

        let node = 0;
        for (const target of preservedTargets) {
          node = Math.max(node, Math.exp(-pointDistanceSquared(point, target.point) / nodeSigma2) * target.weight);
        }
        for (const force of forces) {
          node = Math.max(node, Math.exp(-pointDistanceSquared(point, force.point) / nodeSigma2) * 0.95);
        }

        const interiorBias = 0.28 + clamp01((surfaceDistance[idx] - 0.8) / 3.8) * 0.92;
        out[idx] = clamp01(Math.max(corridor * 1.18, node * 0.82) * interiorBias);
      }
    }
  }

  return out;
}

function buildConnectorSegments(
  preservedTargets: SolverTarget[],
  forces: ForceVec[]
): Array<{ start: [number, number, number]; end: [number, number, number]; weight: number }> {
  const segments: Array<{ start: [number, number, number]; end: [number, number, number]; weight: number }> = [];
  const pairKeys = new Set<string>();
  for (let i = 0; i < preservedTargets.length; i += 1) {
    const nearest = preservedTargets
      .map((target, idx) => ({
        idx,
        dist2: idx === i ? Number.POSITIVE_INFINITY : pointDistanceSquared(preservedTargets[i].point, target.point)
      }))
      .filter((entry) => preservedTargets[entry.idx].groupId !== preservedTargets[i].groupId)
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, preservedTargets[i].role === "anchor" ? 2 : 1);

    for (const entry of nearest) {
      const left = Math.min(i, entry.idx);
      const right = Math.max(i, entry.idx);
      const key = `${left}:${right}`;
      if (pairKeys.has(key)) {
        continue;
      }
      pairKeys.add(key);
      segments.push({
        start: preservedTargets[left].point,
        end: preservedTargets[right].point,
        weight: Math.sqrt(Math.max(preservedTargets[left].weight * preservedTargets[right].weight, 0.25))
      });
    }
  }

  for (const force of forces) {
    if (!preservedTargets.length) break;
    const nearestTargets = preservedTargets
      .map((target, idx) => ({ idx, dist2: pointDistanceSquared(force.point, target.point) }))
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, Math.min(3, preservedTargets.length));
    for (const entry of nearestTargets) {
      segments.push({
        start: force.point,
        end: preservedTargets[entry.idx].point,
        weight: Math.max(0.7, Math.sqrt(preservedTargets[entry.idx].weight) * 0.9)
      });
    }
  }

  return segments;
}

function rasterizeConnectorMask(
  grid: ReturnType<typeof buildVoxelGrid>,
  domainMask: Uint8Array,
  segments: Array<{ start: [number, number, number]; end: [number, number, number] }>,
  radius: number
): Uint8Array {
  const mask = new Uint8Array(grid.total);
  const r2 = radius * radius;
  const stepInv = 1 / grid.step;

  for (const segment of segments) {
    const minX = Math.min(segment.start[0], segment.end[0]) - radius;
    const maxX = Math.max(segment.start[0], segment.end[0]) + radius;
    const minY = Math.min(segment.start[1], segment.end[1]) - radius;
    const maxY = Math.max(segment.start[1], segment.end[1]) + radius;
    const minZ = Math.min(segment.start[2], segment.end[2]) - radius;
    const maxZ = Math.max(segment.start[2], segment.end[2]) + radius;

    const gx0 = Math.max(0, Math.floor((minX - grid.origin[0]) * stepInv));
    const gx1 = Math.min(grid.nx - 1, Math.ceil((maxX - grid.origin[0]) * stepInv));
    const gy0 = Math.max(0, Math.floor((minY - grid.origin[1]) * stepInv));
    const gy1 = Math.min(grid.ny - 1, Math.ceil((maxY - grid.origin[1]) * stepInv));
    const gz0 = Math.max(0, Math.floor((minZ - grid.origin[2]) * stepInv));
    const gz1 = Math.min(grid.nz - 1, Math.ceil((maxZ - grid.origin[2]) * stepInv));

    for (let z = gz0; z <= gz1; z += 1) {
      for (let y = gy0; y <= gy1; y += 1) {
        for (let x = gx0; x <= gx1; x += 1) {
          const idx = x + grid.nx * (y + grid.ny * z);
          if (!domainMask[idx]) {
            continue;
          }
          const point: [number, number, number] = [
            grid.origin[0] + (x + 0.5) * grid.step,
            grid.origin[1] + (y + 0.5) * grid.step,
            grid.origin[2] + (z + 0.5) * grid.step
          ];
          if (distanceToSegmentSquared(point, segment.start, segment.end) <= r2) {
            mask[idx] = 1;
          }
        }
      }
    }
  }

  return mask;
}

function thresholdFromMaskedValues(
  values: Float32Array,
  sampleMask: Uint8Array,
  domainMask: Uint8Array,
  quantile: number
): number {
  const bins = 256;
  const histogram = new Uint32Array(bins);
  let total = 0;

  for (let i = 0; i < values.length; i += 1) {
    if (!domainMask[i] || !sampleMask[i]) {
      continue;
    }
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(clamp01(values[i]) * (bins - 1))));
    histogram[bin] += 1;
    total += 1;
  }

  if (total === 0) {
    return 0.5;
  }

  const target = Math.max(1, Math.round(total * clamp01(quantile)));
  let seen = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    seen += histogram[bin];
    if (seen >= target) {
      return bin / (bins - 1);
    }
  }

  return 0.5;
}

function retainConnectedToAnchorsLocal(
  occupancy: Uint8Array,
  domainMask: Uint8Array,
  anchorMask: Uint8Array,
  preserveMask: Uint8Array,
  grid: ReturnType<typeof buildVoxelGrid>
): Uint8Array {
  const kept = new Uint8Array(occupancy.length);
  const visited = new Uint8Array(occupancy.length);
  const queue = new Int32Array(occupancy.length);
  let head = 0;
  let tail = 0;

  const enqueue = (idx: number): void => {
    if (visited[idx] || !domainMask[idx] || !occupancy[idx]) {
      return;
    }
    visited[idx] = 1;
    kept[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  for (let i = 0; i < occupancy.length; i += 1) {
    if (anchorMask[i] || preserveMask[i]) {
      enqueue(i);
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const z = Math.floor(idx / (grid.nx * grid.ny));
    const y = Math.floor((idx - z * grid.nx * grid.ny) / grid.nx);
    const x = idx - z * grid.nx * grid.ny - y * grid.nx;
    const neighbors = [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1]
    ] as const;
    for (const [nx, ny, nz] of neighbors) {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
        continue;
      }
      enqueue(nx + grid.nx * (ny + grid.ny * nz));
    }
  }

  for (let i = 0; i < preserveMask.length; i += 1) {
    if (preserveMask[i]) {
      kept[i] = 1;
    }
  }

  return kept;
}

async function solveInWorker(payload: WorkerInMessage["payload"]): Promise<{ outcomes: OutcomeV2[]; qualityProfile: BrowserQualityProfile; warnings: string[] }> {
  const request = payload.request;
  const warnings: string[] = [];

  postProgress({
    stage: "parse",
    progress: 0.03,
    status: "running",
    qualityProfile: payload.qualityProfile,
    warnings
  });

  const positions = payload.geometry.positions;
  if (!positions || positions.length < 27 || positions.length % 9 !== 0) {
    throw new Error("Browser solve requires non-indexed triangle positions");
  }

  const totalFaces = faceCountFromPositions(positions);
  const preservedData = getPreservedData(request, totalFaces, positions);
  const fixedFaceSet = fixedFacesFromLoadCases(request);
  const designFaceSet = getFaceSet(request.designRegion.faceIndices, totalFaces);
  const obstacleFaceSet = new Set<number>();
  for (const region of request.obstacleRegions) {
    for (const face of region.faceIndices) {
      if (face >= 0 && face < totalFaces) {
        obstacleFaceSet.add(face);
      }
    }
  }

  if (preservedData.allFaces.size === 0) {
    throw new Error("No preserved faces selected");
  }

  const forces = normalizeForces(request);
  if (forces.length === 0) {
    throw new Error("No force definitions provided");
  }

  const estimatedMemory = estimateSolverMemoryBytes(3_200_000, request.targets.outcomeCount);
  const qualityResolution = resolveQualityProfile(payload.qualityProfile, estimatedMemory);
  const qualityConfig = qualityResolution.profile;
  warnings.push(...qualityResolution.warnings);

  postProgress({
    stage: "constraint-map",
    progress: 0.08,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const bbox = computeBoundingBox(positions);
  const grid = buildVoxelGrid(positions, qualityConfig.targetVoxels);
  const { domainMask, surfaceMask } = voxelizeDomain(positions, grid);

  postProgress({
    stage: "voxelize",
    progress: 0.16,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const preserveMask = rasterizePreservedMask(
    positions,
    new Set([...preservedData.allFaces, ...fixedFaceSet]),
    grid,
    grid.step * 0.95
  );

  const obstacleMask = obstacleFaceSet.size
    ? dilateMask(rasterizePreservedMask(positions, obstacleFaceSet, grid, grid.step * 0.95), grid, 1)
    : new Uint8Array(grid.total);

  const designCoverage = totalFaces > 0 ? designFaceSet.size / totalFaces : 0;
  const designMask =
    !designFaceSet.size || designCoverage > 0.55
      ? domainMask.slice()
      : dilateMask(rasterizePreservedMask(positions, designFaceSet, grid, grid.step * 1.1), grid, 6);

  for (let i = 0; i < preserveMask.length; i += 1) {
    if (!domainMask[i]) {
      preserveMask[i] = 0;
    }
    if (obstacleMask[i]) {
      designMask[i] = 0;
    }
  }

  const constrainedDomain = new Uint8Array(grid.total);
  let constrainedCount = 0;
  for (let i = 0; i < grid.total; i += 1) {
    const allowed = domainMask[i] && designMask[i] && !obstacleMask[i];
    constrainedDomain[i] = allowed ? 1 : 0;
    if (allowed) {
      constrainedCount += 1;
    }
  }

  if (constrainedCount < 1000) {
    throw new Error("Design region/obstacle constraints removed most of the domain");
  }

  const forceSeeds = forceSeedMask(forces, constrainedDomain, grid);
  const preserveSeedMask = new Uint8Array(grid.total);
  for (let i = 0; i < grid.total; i += 1) {
    preserveSeedMask[i] = preserveMask[i] ? 1 : 0;
  }

  const preservedDistance = distanceFromMask(preserveSeedMask, constrainedDomain, grid);
  const forceDistance = distanceFromMask(forceSeeds, constrainedDomain, grid);
  const surfaceDistance = distanceFromMask(surfaceMask, constrainedDomain, grid);

  const interfaceProfiles = buildInterfaceProfiles(positions, preservedData.groups);
  const preservedTargets = buildSolverTargets(interfaceProfiles);
  const trussBoostField =
    preservedTargets.length >= 2
      ? buildTrussBoostField(grid, constrainedDomain, surfaceDistance, preservedTargets, forces)
      : null;

  postProgress({
    stage: "fem-solve",
    progress: 0.3,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const baseFields = computeBaseInfluenceFields(
    grid,
    constrainedDomain,
    preserveMask,
    preservedDistance,
    forceDistance,
    forces,
    preservedTargets,
    qualityConfig.connectivityIterations
  );

  const outcomes: OutcomeV2[] = [];
  const acceptedVariants: { occupancy: Uint8Array; signature: ReturnType<typeof computeSignature> }[] = [];
  const targetUnique = Math.max(1, request.targets.outcomeCount - 1);

  const startedAt = Date.now();
  const maxAttempts = request.targets.outcomeCount * 8;
  let attempt = 0;
  const baselineVolume = baselineVolumeFromPositions(positions);
  const targetFraction = clamp01(1 - request.targets.massReductionGoalPct / 100);

  while (outcomes.length < request.targets.outcomeCount && attempt < maxAttempts) {
    const params = variantParams(outcomes.length, request.targets.outcomeCount, qualityConfig.minThicknessVoxels, attempt);
    const goalDrivenFraction = clamp01(0.08 + targetFraction * 0.44);
    params.targetVolumeFraction = clamp01(goalDrivenFraction + (params.targetVolumeFraction - 0.18) * 0.82);
    const influence = combineInfluenceFields(baseFields, constrainedDomain, params, request.targets.safetyFactor);
    if (trussBoostField) {
      for (let i = 0; i < influence.length; i += 1) {
        if (!constrainedDomain[i]) {
          continue;
        }
        influence[i] = clamp01(Math.max(influence[i] * 0.26, trussBoostField[i]));
      }
    }
    for (let i = 0; i < influence.length; i += 1) {
      if (!constrainedDomain[i] || preserveMask[i]) {
        continue;
      }
      const surfaceDepth = Math.min(surfaceDistance[i], 6);
      const shellPenalty = Math.exp(-surfaceDepth / 1.4);
      const protectedBand = Math.max(
        Math.exp(-preservedDistance[i] * 0.95),
        Math.exp(-forceDistance[i] * 0.9)
      );
      const corridorBias = trussBoostField ? trussBoostField[i] : 0;
      const attenuation = 1 - shellPenalty * (1 - protectedBand) * (0.82 + params.voidBias * 0.55);
      const coreBoost = clamp01((surfaceDepth - 1.2) / 4.2) * (0.16 + params.medialWeight * 0.12);
      let shaped = influence[i] * attenuation + coreBoost;
      if (surfaceDepth < 1.25) {
        shaped *= 0.28 + Math.max(corridorBias * 1.35, protectedBand * 0.78);
      }
      if (surfaceDepth < 0.8 && corridorBias < 0.24 && protectedBand < 0.58) {
        shaped *= 0.18;
      }
      influence[i] = clamp01(shaped);
    }

    const densityResult = solveDensityField({
      grid,
      domainMask: constrainedDomain,
      preserveMask,
      anchorMask: forceSeeds,
      influence,
      targetVolumeFraction: clamp01(params.targetVolumeFraction),
      iterations: qualityConfig.densityIterations,
      smoothFactor: params.smoothFactor,
      minThickness: params.minThickness,
      voidBias: params.voidBias,
      surfaceDistance
    });

    const connectorSegments = buildConnectorSegments(preservedTargets, forces);
    if (connectorSegments.length) {
      const connectorRadius = Math.max(grid.step * 2.1, bbox.diagonal * 0.012);
      const connectorMask = rasterizeConnectorMask(grid, constrainedDomain, connectorSegments, connectorRadius);
      for (let i = 0; i < connectorMask.length; i += 1) {
        if (!connectorMask[i]) {
          continue;
        }
        densityResult.occupancy[i] = 1;
        densityResult.density[i] = Math.max(densityResult.density[i], 0.78);
      }
    }

    const influenceThreshold = thresholdFromMaskedValues(influence, densityResult.occupancy, constrainedDomain, 0.66);
    const corridorThreshold = trussBoostField
      ? thresholdFromMaskedValues(trussBoostField, densityResult.occupancy, constrainedDomain, 0.72)
      : influenceThreshold;
    for (let i = 0; i < densityResult.occupancy.length; i += 1) {
      if (!densityResult.occupancy[i] || !constrainedDomain[i] || preserveMask[i]) {
        continue;
      }
      const collar = preservedDistance[i] <= 1.8 || forceDistance[i] <= 1.6;
      const corridor = trussBoostField ? trussBoostField[i] >= corridorThreshold : false;
      const interiorSpine = influence[i] >= influenceThreshold && surfaceDistance[i] > 0.75;
      const deepCore = surfaceDistance[i] > 1.45 && influence[i] >= influenceThreshold * 0.82;
      if (!(collar || corridor || interiorSpine || deepCore)) {
        densityResult.occupancy[i] = 0;
        densityResult.density[i] = Math.min(densityResult.density[i], 0.42);
      }
    }
    let refinedOccupancy = retainConnectedToAnchorsLocal(
      densityResult.occupancy,
      constrainedDomain,
      forceSeeds,
      preserveMask,
      grid
    );
    refinedOccupancy = erodeMask(dilateMask(refinedOccupancy, grid, 1), grid, 1);
    refinedOccupancy = retainConnectedToAnchorsLocal(
      refinedOccupancy,
      constrainedDomain,
      forceSeeds,
      preserveMask,
      grid
    );
    densityResult.occupancy = refinedOccupancy;
    for (let i = 0; i < densityResult.density.length; i += 1) {
      if (densityResult.occupancy[i]) {
        densityResult.density[i] = Math.max(densityResult.density[i], 0.64);
      } else if (!preserveMask[i]) {
        densityResult.density[i] = Math.min(densityResult.density[i], 0.4);
      }
    }

    // Reconstruct only from retained generated occupancy. Meshing the entire
    // constrained domain lets low-density shell remnants bleed back into the
    // final surface, which makes outcomes look like the source part instead of
    // a carved load path.
    const generatedDomain = new Uint8Array(constrainedDomain.length);
    const generatedDensity = new Float32Array(densityResult.density.length);
    for (let i = 0; i < generatedDomain.length; i += 1) {
      if (preserveMask[i] || !densityResult.occupancy[i]) {
        continue;
      }
      generatedDomain[i] = 1;
      generatedDensity[i] = Math.max(0.72, densityResult.density[i]);
    }

    const signature = computeSignature(densityResult.occupancy, constrainedDomain);
    const unique = isUniqueVariant(densityResult.occupancy, signature, acceptedVariants, constrainedDomain);

    const allowDuplicateFallback =
      !unique &&
      outcomes.length < request.targets.outcomeCount &&
      attempt >= Math.floor(maxAttempts * 0.65);

    if (!unique && !allowDuplicateFallback) {
      attempt += 1;
      continue;
    }

    postProgress({
      stage: "topology-opt",
      progress: 0.38 + (attempt / maxAttempts) * 0.32,
      status: "running",
      qualityProfile: qualityConfig.id,
      warnings
    });

    const generatedGeometry = extractIsoSurface(
      grid,
      generatedDensity,
      generatedDomain,
      0.52,
      qualityConfig.taubinIterations
    );

    const preservedGeometry = makePreservedGeometry(positions, preservedData.allFaces);
    const glbBase64 = await exportOutcomeGlb(preservedGeometry, generatedGeometry);

    const metrics = computeOutcomeMetrics({
      generatedGeometry,
      preservedGeometry,
      baselineVolume,
      units: request.units,
      material: request.material,
      forces,
      characteristicLength: bbox.diagonal
    });

    outcomes.push({
      id: `OUT-${String(outcomes.length + 1).padStart(2, "0")}`,
      optimizedModel: {
        format: "glb",
        dataBase64: glbBase64
      },
      metrics,
      variantParams: {
        targetVolumeFraction: Number(params.targetVolumeFraction.toFixed(4)),
        smoothFactor: Number(params.smoothFactor.toFixed(4)),
        minThickness: params.minThickness,
        ribBoost: Number(params.ribBoost.toFixed(4)),
        medialWeight: Number(params.medialWeight.toFixed(4)),
        voidBias: Number(params.voidBias.toFixed(4))
      }
    });

    acceptedVariants.push({
      occupancy: densityResult.occupancy,
      signature
    });

    const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const perOutcome = elapsedSec / outcomes.length;
    const remaining = request.targets.outcomeCount - outcomes.length;

    postProgress({
      stage: "reconstruct",
      progress: 0.7 + (outcomes.length / request.targets.outcomeCount) * 0.2,
      status: "running",
      qualityProfile: qualityConfig.id,
      warnings,
      etaSeconds: Math.ceil(remaining * perOutcome)
    });

    preservedGeometry.dispose();
    generatedGeometry.dispose();
    attempt += 1;
  }

  if (acceptedVariants.length < targetUnique) {
    warnings.push(
      `Uniqueness gate could not guarantee ${targetUnique} distinct outcomes; generated ${acceptedVariants.length}.`
    );
  }

  if (outcomes.length < request.targets.outcomeCount) {
    warnings.push(
      `Requested ${request.targets.outcomeCount} outcomes but only ${outcomes.length} were synthesized within runtime limits.`
    );
  }

  outcomes.sort(
    (a, b) =>
      outcomeRankScore(a, request.targets.safetyFactor, request.targets.massReductionGoalPct) -
      outcomeRankScore(b, request.targets.safetyFactor, request.targets.massReductionGoalPct)
  );
  for (let i = 0; i < outcomes.length; i += 1) {
    outcomes[i].id = `OUT-${String(i + 1).padStart(2, "0")}`;
    outcomes[i].variantParams = {
      ...outcomes[i].variantParams,
      rankScore: Number(
        outcomeRankScore(outcomes[i], request.targets.safetyFactor, request.targets.massReductionGoalPct).toFixed(4)
      )
    };
  }

  postProgress({
    stage: "rank-export",
    progress: 0.96,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings,
    etaSeconds: 1
  });

  postProgress({
    stage: "complete",
    progress: 1,
    status: "succeeded",
    qualityProfile: qualityConfig.id,
    warnings,
    etaSeconds: 0
  });

  return {
    outcomes,
    qualityProfile: qualityConfig.id,
    warnings
  };
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  if (!event.data || event.data.type !== "solve") {
    return;
  }

  void solveInWorker(event.data.payload)
    .then((result) => {
      postMessageTyped({
        type: "result",
        outcomes: result.outcomes,
        qualityProfile: result.qualityProfile,
        warnings: result.warnings
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Browser solve failed";
      postMessageTyped({ type: "error", error: message });
    });
};

export {};
