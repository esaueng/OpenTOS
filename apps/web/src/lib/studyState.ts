import type { BuildSolvePayloadArgs, RegionLabel, SolvePayload } from "../types";

export function initializeFaceLabels(faceCount: number): RegionLabel[] {
  return Array.from({ length: faceCount }, () => "design");
}

export function applyFaceLabels(
  currentLabels: RegionLabel[],
  faceIndices: number[],
  label: RegionLabel
): RegionLabel[] {
  const updated = [...currentLabels];
  for (const index of faceIndices) {
    if (index >= 0 && index < updated.length) {
      updated[index] = label;
    }
  }
  return updated;
}

export function normalizeDirection(direction: [number, number, number]): [number, number, number] {
  const [x, y, z] = direction;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= 1e-8) {
    return [0, 0, 1];
  }

  return [x / length, y / length, z / length];
}

export function getPreservedFaceIndices(labels: RegionLabel[]): number[] {
  const preserved: number[] = [];
  labels.forEach((label, idx) => {
    if (label === "preserved") {
      preserved.push(idx);
    }
  });
  return preserved;
}

export function getObstacleFaceIndices(labels: RegionLabel[]): number[] {
  const obstacle: number[] = [];
  labels.forEach((label, idx) => {
    if (label === "obstacle") {
      obstacle.push(idx);
    }
  });
  return obstacle;
}

export function getDesignFaceIndices(labels: RegionLabel[]): number[] {
  const design: number[] = [];
  labels.forEach((label, idx) => {
    if (label === "design" || label === "unassigned") {
      design.push(idx);
    }
  });
  return design;
}

export function mapDisplayPointToSolve(
  point: [number, number, number],
  solveToDisplayOffset: [number, number, number]
): [number, number, number] {
  return [
    point[0] - solveToDisplayOffset[0],
    point[1] - solveToDisplayOffset[1],
    point[2] - solveToDisplayOffset[2]
  ];
}

export function buildSolvePayload(args: BuildSolvePayloadArgs): SolvePayload {
  const preserved = getPreservedFaceIndices(args.faceLabels);
  const design = getDesignFaceIndices(args.faceLabels);
  const obstacle = getObstacleFaceIndices(args.faceLabels);
  return {
    model: {
      format: args.model.format,
      dataBase64: args.model.dataBase64
    },
    units: args.units,
    designRegion: {
      faceIndices: design.length > 0 ? design : args.faceLabels.map((_, idx) => idx).filter((idx) => !preserved.includes(idx))
    },
    preservedRegions: [
      {
        id: "preserved-main",
        faceIndices: preserved
      }
    ],
    obstacleRegions: obstacle.length
      ? [
          {
            id: "obstacle-main",
            faceIndices: obstacle
          }
        ]
      : [],
    loadCases: [
      {
        id: "LC-1",
        fixedRegions: ["preserved-main"],
        forces: args.forces.map((force) => ({
          point: mapDisplayPointToSolve(force.point, args.model.solveToDisplayOffset),
          direction: normalizeDirection(force.direction),
          magnitude: force.magnitude,
          unit: force.unit,
          label: force.label
        }))
      }
    ],
    material: args.material,
    targets: {
      safetyFactor: args.targetSafetyFactor,
      outcomeCount: args.outcomeCount,
      massReductionGoalPct: args.massReductionGoalPct
    }
  };
}
