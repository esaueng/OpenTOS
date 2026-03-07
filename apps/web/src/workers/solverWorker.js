/// <reference lib="webworker" />
import { resolveQualityProfile } from "./solver/config";
import { buildVoxelGrid, computeBoundingBox, estimateSolverMemoryBytes, faceCountFromPositions, getFaceSet, getPreservedData } from "./solver/geometry";
import { combineInfluenceFields, computeBaseInfluenceFields } from "./solver/fields";
import { exportOutcomeGlb } from "./solver/export";
import { clamp01 } from "./solver/math";
import { extractIsoSurface, makePreservedGeometry } from "./solver/mesh";
import { computeOutcomeMetrics, geometryVolume } from "./solver/metrics";
import { solveDensityField } from "./solver/optimize";
import { computeSignature, isUniqueVariant, variantParams } from "./solver/variants";
import { dilateMask, distanceFromMask, forceSeedMask, rasterizePreservedMask, voxelizeDomain } from "./solver/voxel";
const FORCE_TO_NEWTONS = {
    N: 1,
    lb: 4.4482216152605
};
function postMessageTyped(message) {
    self.postMessage(message);
}
function postProgress(args) {
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
function normalizeForces(request) {
    const all = [];
    for (const loadCase of request.loadCases) {
        for (const force of loadCase.forces) {
            const [dx, dy, dz] = force.direction;
            const len = Math.hypot(dx, dy, dz);
            const direction = len <= 1e-12 ? [0, 0, 1] : [dx / len, dy / len, dz / len];
            all.push({
                point: [force.point[0], force.point[1], force.point[2]],
                direction,
                magnitudeN: force.magnitude * FORCE_TO_NEWTONS[force.unit]
            });
        }
    }
    return all;
}
function fixedFacesFromLoadCases(request) {
    const byId = new Map();
    for (const region of request.preservedRegions) {
        byId.set(region.id, region.faceIndices);
    }
    const fixed = new Set();
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
function baselineVolumeFromPositions(positions) {
    const g = makePreservedGeometry(positions, new Set(Array.from({ length: faceCountFromPositions(positions) }, (_, i) => i)));
    const volume = geometryVolume(g);
    g.dispose();
    return volume;
}
function outcomeRankScore(outcome, targetSafetyFactor, targetMassReductionPct) {
    const safetyShortfall = Math.max(0, targetSafetyFactor - outcome.metrics.safetyIndexProxy);
    const massGap = Math.abs(targetMassReductionPct - outcome.metrics.massReductionPct);
    return (outcome.metrics.complianceProxy * 0.55 +
        outcome.metrics.stressProxy * 0.18 +
        outcome.metrics.displacementProxy * 0.14 +
        safetyShortfall * 28 +
        massGap * 0.24 -
        Math.min(outcome.metrics.massReductionPct, targetMassReductionPct) * 0.08);
}
async function solveInWorker(payload) {
    const request = payload.request;
    const warnings = [];
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
    const fixedFaceSet = fixedFacesFromLoadCases(request);
    const designFaceSet = getFaceSet(request.designRegion.faceIndices, totalFaces);
    const obstacleFaceSet = new Set();
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
    const { domainMask } = voxelizeDomain(positions, grid);
    postProgress({
        stage: "voxelize",
        progress: 0.16,
        status: "running",
        qualityProfile: qualityConfig.id,
        warnings
    });
    const preserveMask = rasterizePreservedMask(positions, new Set([...preservedData.allFaces, ...fixedFaceSet]), grid, grid.step * 0.95);
    const obstacleMask = obstacleFaceSet.size
        ? dilateMask(rasterizePreservedMask(positions, obstacleFaceSet, grid, grid.step * 0.95), grid, 1)
        : new Uint8Array(grid.total);
    const designMask = designFaceSet.size
        ? dilateMask(rasterizePreservedMask(positions, designFaceSet, grid, grid.step * 1.1), grid, 3)
        : domainMask.slice();
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
    postProgress({
        stage: "fem-solve",
        progress: 0.3,
        status: "running",
        qualityProfile: qualityConfig.id,
        warnings
    });
    const baseFields = computeBaseInfluenceFields(grid, constrainedDomain, preserveMask, preservedDistance, forceDistance, forces, qualityConfig.connectivityIterations);
    const outcomes = [];
    const acceptedVariants = [];
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
            voidBias: params.voidBias
        });
        const signature = computeSignature(densityResult.occupancy, constrainedDomain);
        const unique = isUniqueVariant(densityResult.occupancy, signature, acceptedVariants, constrainedDomain);
        const allowDuplicateFallback = !unique &&
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
        const generatedGeometry = extractIsoSurface(grid, densityResult.density, constrainedDomain, 0.52, qualityConfig.taubinIterations);
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
        warnings.push(`Uniqueness gate could not guarantee ${targetUnique} distinct outcomes; generated ${acceptedVariants.length}.`);
    }
    if (outcomes.length < request.targets.outcomeCount) {
        warnings.push(`Requested ${request.targets.outcomeCount} outcomes but only ${outcomes.length} were synthesized within runtime limits.`);
    }
    outcomes.sort((a, b) => outcomeRankScore(a, request.targets.safetyFactor, request.targets.massReductionGoalPct) -
        outcomeRankScore(b, request.targets.safetyFactor, request.targets.massReductionGoalPct));
    for (let i = 0; i < outcomes.length; i += 1) {
        outcomes[i].id = `OUT-${String(i + 1).padStart(2, "0")}`;
        outcomes[i].variantParams = {
            ...outcomes[i].variantParams,
            rankScore: Number(outcomeRankScore(outcomes[i], request.targets.safetyFactor, request.targets.massReductionGoalPct).toFixed(4))
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
self.onmessage = (event) => {
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
        .catch((err) => {
        const message = err instanceof Error ? err.message : "Browser solve failed";
        postMessageTyped({ type: "error", error: message });
    });
};
