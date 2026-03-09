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
import { buildOrganicTrussGeometry, extractIsoSurface, makePreservedGeometry } from "./solver/mesh";
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
  preservedTargets: PreservedTarget[],
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
      .sort((a, b) => a.dist2 - b.dist2)
      .slice(0, Math.min(2, preservedTargets.length - 1));
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
      .slice(0, Math.min(2, preservedTargets.length));
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

  const preservedTargets = preservedData.groups
    .map((group) => {
      if (!group.length) {
        return null;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const faceIndex of group) {
        const [cx, cy, cz] = faceCenter(positions, faceIndex);
        sx += cx;
        sy += cy;
        sz += cz;
      }
      const inv = 1 / group.length;
      return {
        point: [sx * inv, sy * inv, sz * inv] as [number, number, number],
        weight: Math.min(1.8, Math.max(0.6, Math.sqrt(group.length) * 0.14))
      };
    })
    .filter((value): value is { point: [number, number, number]; weight: number } => value !== null);
  const trussBoostField =
    preservedTargets.length >= 3
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
    params.targetVolumeFraction = clamp01(targetFraction + (params.targetVolumeFraction - 0.22) * 0.55);
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
        Math.exp(-preservedDistance[i] * 0.45),
        Math.exp(-forceDistance[i] * 0.45)
      );
      const attenuation = 1 - shellPenalty * (1 - protectedBand) * (0.82 + params.voidBias * 0.55);
      const coreBoost = clamp01((surfaceDepth - 1.2) / 4.2) * (0.16 + params.medialWeight * 0.12);
      influence[i] = clamp01(influence[i] * attenuation + coreBoost);
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

    const generatedGeometry =
      trussBoostField && preservedTargets.length >= 3
        ? buildOrganicTrussGeometry({
            preservedTargets,
            forces,
            bboxCenter: [
              (bbox.min[0] + bbox.max[0]) * 0.5,
              (bbox.min[1] + bbox.max[1]) * 0.5,
              (bbox.min[2] + bbox.max[2]) * 0.5
            ],
            characteristicLength: bbox.diagonal,
            taubinIterations: qualityConfig.taubinIterations
          })
        : extractIsoSurface(
            grid,
            densityResult.density,
            constrainedDomain,
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
