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

export function buildSolvePayload(args: BuildSolvePayloadArgs): SolvePayload {
  const preserved = getPreservedFaceIndices(args.faceLabels);
  return {
    model: {
      format: args.model.format,
      dataBase64: args.model.dataBase64
    },
    units: args.units,
    preservedRegions: [
      {
        id: "preserved-main",
        faceIndices: preserved
      }
    ],
    forces: args.forces.map((force) => ({
      point: force.point,
      direction: normalizeDirection(force.direction),
      magnitude: force.magnitude,
      unit: force.unit,
      label: force.label
    })),
    material: args.material,
    targetSafetyFactor: args.targetSafetyFactor,
    outcomeCount: args.outcomeCount,
    manufacturingConstraint: args.manufacturingConstraint
  };
}
