import { estimateSolverMemoryBytes } from "./geometry";
import type { BrowserQualityProfile, QualityProfileConfig } from "./types";

const QUALITY_PROFILES: Record<BrowserQualityProfile, QualityProfileConfig> = {
  "high-fidelity": {
    id: "high-fidelity",
    targetVoxels: 3_200_000,
    minThicknessVoxels: 1,
    smoothIterations: 4,
    taubinIterations: 12,
    densityIterations: 30,
    connectivityIterations: 16,
    maxTriangles: 260_000
  },
  balanced: {
    id: "balanced",
    targetVoxels: 1_500_000,
    minThicknessVoxels: 1,
    smoothIterations: 3,
    taubinIterations: 9,
    densityIterations: 22,
    connectivityIterations: 11,
    maxTriangles: 170_000
  },
  "fast-preview": {
    id: "fast-preview",
    targetVoxels: 550_000,
    minThicknessVoxels: 1,
    smoothIterations: 2,
    taubinIterations: 8,
    densityIterations: 11,
    connectivityIterations: 7,
    maxTriangles: 90_000
  }
};

const QUALITY_ORDER: BrowserQualityProfile[] = ["high-fidelity", "balanced", "fast-preview"];

const MEMORY_BUDGET_BYTES = 1_300_000_000;

export function resolveQualityProfile(
  requested: BrowserQualityProfile,
  outcomeCount: number,
  memoryBudgetBytes = MEMORY_BUDGET_BYTES
): {
  profile: QualityProfileConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const requestedProfile = QUALITY_PROFILES[requested];

  if (estimateSolverMemoryBytes(requestedProfile.targetVoxels, outcomeCount) <= memoryBudgetBytes) {
    return { profile: requestedProfile, warnings };
  }

  for (let i = QUALITY_ORDER.indexOf(requested) + 1; i < QUALITY_ORDER.length; i += 1) {
    const candidate = QUALITY_PROFILES[QUALITY_ORDER[i]];
    if (estimateSolverMemoryBytes(candidate.targetVoxels, outcomeCount) <= memoryBudgetBytes) {
      warnings.push(`Quality automatically downgraded to ${candidate.id} due to browser memory pressure.`);
      return { profile: candidate, warnings };
    }
  }

  const fallback = QUALITY_PROFILES["fast-preview"];
  if (requested !== fallback.id) {
    warnings.push(
      `Quality automatically downgraded to ${fallback.id}; requested ${requested} exceeded safe memory budget.`
    );
  }
  return { profile: fallback, warnings };
}
