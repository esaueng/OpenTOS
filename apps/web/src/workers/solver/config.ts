import type { BrowserQualityProfile, QualityProfileConfig } from "./types";

const QUALITY_PROFILES: Record<BrowserQualityProfile, QualityProfileConfig> = {
  "high-fidelity": {
    id: "high-fidelity",
    targetVoxels: 3_200_000,
    minThicknessVoxels: 2,
    smoothIterations: 4,
    taubinIterations: 18,
    densityIterations: 30,
    connectivityIterations: 16,
    maxTriangles: 260_000
  },
  balanced: {
    id: "balanced",
    targetVoxels: 1_500_000,
    minThicknessVoxels: 2,
    smoothIterations: 3,
    taubinIterations: 13,
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

export function resolveQualityProfile(requested: BrowserQualityProfile, estimatedBytes: number): {
  profile: QualityProfileConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const memoryBudget = 1_300_000_000;

  let chosen = QUALITY_PROFILES[requested];
  if (estimatedBytes <= memoryBudget) {
    return { profile: chosen, warnings };
  }

  const startIdx = QUALITY_ORDER.indexOf(requested);
  for (let i = Math.max(startIdx, 0) + 1; i < QUALITY_ORDER.length; i += 1) {
    const candidate = QUALITY_PROFILES[QUALITY_ORDER[i]];
    const scale = candidate.targetVoxels / QUALITY_PROFILES[requested].targetVoxels;
    if (estimatedBytes * scale <= memoryBudget) {
      chosen = candidate;
      warnings.push(
        `Quality automatically downgraded to ${candidate.id} due to browser memory pressure.`
      );
      break;
    }
  }

  if (chosen.id === requested) {
    const fallback = QUALITY_PROFILES["fast-preview"];
    if (requested !== fallback.id) {
      warnings.push(
        `Quality automatically downgraded to ${fallback.id}; requested ${requested} exceeded safe memory budget.`
      );
      chosen = fallback;
    }
  }

  return { profile: chosen, warnings };
}

export function qualityProfileConfig(profile: BrowserQualityProfile): QualityProfileConfig {
  return QUALITY_PROFILES[profile];
}
