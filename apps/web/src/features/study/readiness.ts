import type { ForceState, LoadCaseState, RegionLabel, UploadedModel } from "../../types";

export interface LocalReadiness {
  ready: boolean;
  completed: number;
  total: number;
  blockers: string[];
  checks: Array<{ label: string; complete: boolean }>;
}

export function evaluateReadiness(args: {
  model: UploadedModel | null;
  faceLabels: RegionLabel[];
  forces: ForceState[];
  loadCases: LoadCaseState[];
}): LocalReadiness {
  const hasFixed = args.faceLabels.includes("fixed");
  const hasPreserved = args.faceLabels.includes("preserved") || hasFixed;
  const hasLoad = args.forces.length > 0;
  const everyActiveCaseFixed = args.loadCases
    .filter((loadCase) => args.forces.some((force) => force.loadCaseId === loadCase.id))
    .every((loadCase) => loadCase.fixedRegionIds.length > 0);
  const checks = [
    { label: "Model loaded", complete: Boolean(args.model) },
    { label: "Preserved interface marked", complete: hasPreserved },
    { label: "Fixed support marked", complete: hasFixed },
    { label: "Load applied", complete: hasLoad },
    { label: "Active load cases constrained", complete: hasLoad && everyActiveCaseFixed }
  ];
  const blockers = checks.filter((check) => !check.complete).map((check) => check.label);
  return { ready: blockers.length === 0, completed: checks.length - blockers.length, total: checks.length, blockers, checks };
}
