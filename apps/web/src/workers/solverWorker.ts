/// <reference lib="webworker" />

import type { Outcome, SolveRequest } from "@contracts/index";

import { resolveQualityProfile } from "./solver/config";
import {
  buildVoxelGrid,
  computeBoundingBox,
  estimateSolverMemoryBytes,
  faceCountFromPositions,
  getPreservedData
} from "./solver/geometry";
import { combineInfluenceFields, computeBaseInfluenceFields } from "./solver/fields";
import { exportOutcomeGlb } from "./solver/export";
import { clamp01 } from "./solver/math";
import { extractIsoSurface, makePreservedGeometry } from "./solver/mesh";
import { computeOutcomeMetrics } from "./solver/metrics";
import { solveDensityField } from "./solver/optimize";
import type {
  BrowserQualityProfile,
  ForceVec,
  WorkerInMessage,
  WorkerOutMessage,
  WorkerStage,
  WorkerStatus
} from "./solver/types";
import { computeSignature, isUniqueVariant, variantParams } from "./solver/variants";
import {
  distanceFromMask,
  forceSeedMask,
  regionCenterMask,
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

function normalizeForces(request: SolveRequest): ForceVec[] {
  return request.forces.map((force) => {
    const [dx, dy, dz] = force.direction;
    const len = Math.hypot(dx, dy, dz);
    const direction: [number, number, number] =
      len <= 1e-12 ? [0, 0, 1] : [dx / len, dy / len, dz / len];

    return {
      point: [force.point[0], force.point[1], force.point[2]],
      direction,
      magnitudeN: force.magnitude * FORCE_TO_NEWTONS[force.unit]
    };
  });
}

async function solveInWorker(payload: WorkerInMessage["payload"]): Promise<{ outcomes: Outcome[]; qualityProfile: BrowserQualityProfile; warnings: string[] }> {
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
  const preservedData = getPreservedData(request, totalFaces);

  if (preservedData.allFaces.size === 0) {
    throw new Error("No preserved faces selected");
  }

  if (request.forces.length === 0) {
    throw new Error("No force definitions provided");
  }

  const estimatedMemory = estimateSolverMemoryBytes(3_200_000, request.outcomeCount);
  const qualityResolution = resolveQualityProfile(payload.qualityProfile, estimatedMemory);
  const qualityConfig = qualityResolution.profile;
  warnings.push(...qualityResolution.warnings);

  postProgress({
    stage: "parse",
    progress: 0.08,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const bbox = computeBoundingBox(positions);
  const grid = buildVoxelGrid(positions, qualityConfig.targetVoxels);

  postProgress({
    stage: "voxelize",
    progress: 0.14,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const { domainMask } = voxelizeDomain(positions, grid);
  const preserveMask = rasterizePreservedMask(
    positions,
    preservedData.allFaces,
    grid,
    grid.step * 0.95
  );

  for (let i = 0; i < preserveMask.length; i += 1) {
    if (!domainMask[i]) {
      preserveMask[i] = 0;
    }
  }

  const forces = normalizeForces(request);
  const forceSeeds = forceSeedMask(forces, domainMask, grid);
  const preserveRegionSeeds = regionCenterMask(preservedData.groups, positions, domainMask, grid);

  let forceSeedCount = 0;
  for (let i = 0; i < forceSeeds.length; i += 1) {
    forceSeedCount += forceSeeds[i];
  }
  if (forceSeedCount === 0) {
    throw new Error("Forces could not be mapped into design domain");
  }

  const preserveSeedMask = new Uint8Array(grid.total);
  for (let i = 0; i < grid.total; i += 1) {
    preserveSeedMask[i] = preserveMask[i] || preserveRegionSeeds[i] ? 1 : 0;
  }

  const preservedDistance = distanceFromMask(preserveSeedMask, domainMask, grid);
  const forceDistance = distanceFromMask(forceSeeds, domainMask, grid);

  postProgress({
    stage: "field-solve",
    progress: 0.32,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const baseFields = computeBaseInfluenceFields(
    grid,
    domainMask,
    preservedDistance,
    forceDistance,
    forces,
    qualityConfig.connectivityIterations
  );

  postProgress({
    stage: "variant-synth",
    progress: 0.42,
    status: "running",
    qualityProfile: qualityConfig.id,
    warnings
  });

  const outcomes: Outcome[] = [];
  const acceptedVariants: { occupancy: Uint8Array; signature: ReturnType<typeof computeSignature> }[] = [];
  const targetUnique = Math.max(1, request.outcomeCount - 1);

  const startedAt = Date.now();
  const maxAttempts = request.outcomeCount * 7;
  let attempt = 0;

  while (outcomes.length < request.outcomeCount && attempt < maxAttempts) {
    const params = variantParams(outcomes.length, request.outcomeCount, qualityConfig.minThicknessVoxels, attempt);
    const influence = combineInfluenceFields(baseFields, domainMask, params, request.targetSafetyFactor);

    const densityResult = solveDensityField({
      grid,
      domainMask,
      preserveMask,
      anchorMask: forceSeeds,
      influence,
      targetVolumeFraction: clamp01(params.targetVolumeFraction),
      iterations: qualityConfig.densityIterations,
      smoothFactor: params.smoothFactor,
      minThickness: params.minThickness
    });

    const signature = computeSignature(densityResult.occupancy, domainMask);
    const unique = isUniqueVariant(densityResult.occupancy, signature, acceptedVariants, domainMask);

    const allowDuplicateFallback =
      !unique &&
      outcomes.length < request.outcomeCount &&
      attempt >= Math.floor(maxAttempts * 0.65);

    if (!unique && !allowDuplicateFallback) {
      attempt += 1;
      continue;
    }

    const generatedGeometry = extractIsoSurface(
      grid,
      densityResult.density,
      domainMask,
      0.52,
      qualityConfig.taubinIterations
    );

    const preservedGeometry = makePreservedGeometry(positions, preservedData.allFaces);
    const glbBase64 = await exportOutcomeGlb(preservedGeometry, generatedGeometry);

    const metrics = computeOutcomeMetrics({
      generatedGeometry,
      preservedGeometry,
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
      metrics
    });

    acceptedVariants.push({
      occupancy: densityResult.occupancy,
      signature
    });

    const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const perOutcome = elapsedSec / outcomes.length;
    const remaining = request.outcomeCount - outcomes.length;

    postProgress({
      stage: "variant-synth",
      progress: 0.42 + (outcomes.length / request.outcomeCount) * 0.45,
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

  if (outcomes.length < request.outcomeCount) {
    warnings.push(
      `Requested ${request.outcomeCount} outcomes but only ${outcomes.length} could be synthesized within runtime bounds.`
    );
  }

  postProgress({
    stage: "export",
    progress: 0.93,
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
