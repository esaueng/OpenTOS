import type * as THREE from "three";

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

export function getFixedFaceIndices(labels: RegionLabel[]): number[] {
  const fixed: number[] = [];
  labels.forEach((label, idx) => {
    if (label === "fixed") {
      fixed.push(idx);
    }
  });
  return fixed;
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

function quantizedVertexKey(x: number, y: number, z: number): string {
  const q = 1e5;
  return `${Math.round(x * q)}:${Math.round(y * q)}:${Math.round(z * q)}`;
}

function buildFaceGroups(
  geometry: THREE.BufferGeometry,
  labels: RegionLabel[],
  targetLabel: RegionLabel
): number[][] {
  const positions = geometry.getAttribute("position");
  if (!positions || positions.itemSize !== 3) {
    return [];
  }

  const faceIndices: number[] = [];
  for (let faceIndex = 0; faceIndex < labels.length; faceIndex += 1) {
    if (labels[faceIndex] === targetLabel) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0) {
    return [];
  }

  const targetSet = new Set(faceIndices);
  const adjacency = new Map<number, number[]>();
  const edgeToFaces = new Map<string, number[]>();

  for (const faceIndex of faceIndices) {
    adjacency.set(faceIndex, []);
    const base = faceIndex * 9;
    const keys = [
      quantizedVertexKey(positions.getX(faceIndex * 3), positions.getY(faceIndex * 3), positions.getZ(faceIndex * 3)),
      quantizedVertexKey(positions.getX(faceIndex * 3 + 1), positions.getY(faceIndex * 3 + 1), positions.getZ(faceIndex * 3 + 1)),
      quantizedVertexKey(positions.getX(faceIndex * 3 + 2), positions.getY(faceIndex * 3 + 2), positions.getZ(faceIndex * 3 + 2))
    ] as const;
    const edges: [string, string][] = [
      [keys[0], keys[1]],
      [keys[1], keys[2]],
      [keys[2], keys[0]]
    ];
    for (const [a, b] of edges) {
      const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      const faces = edgeToFaces.get(edgeKey);
      if (faces) {
        faces.push(faceIndex);
      } else {
        edgeToFaces.set(edgeKey, [faceIndex]);
      }
    }
  }

  edgeToFaces.forEach((faces) => {
    if (faces.length < 2) {
      return;
    }
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        const left = faces[i];
        const right = faces[j];
        if (!targetSet.has(left) || !targetSet.has(right)) {
          continue;
        }
        adjacency.get(left)?.push(right);
        adjacency.get(right)?.push(left);
      }
    }
  });

  const groups: number[][] = [];
  const visited = new Set<number>();
  for (const seed of faceIndices) {
    if (visited.has(seed)) {
      continue;
    }
    const queue = [seed];
    const group: number[] = [];
    visited.add(seed);

    while (queue.length > 0) {
      const current = queue.pop()!;
      group.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    group.sort((a, b) => a - b);
    groups.push(group);
  }

  return groups;
}

export function buildSolvePayload(args: BuildSolvePayloadArgs): SolvePayload {
  const preserved = getPreservedFaceIndices(args.faceLabels);
  const fixed = getFixedFaceIndices(args.faceLabels);
  const design = getDesignFaceIndices(args.faceLabels);
  const obstacle = getObstacleFaceIndices(args.faceLabels);
  const fixedGroups = buildFaceGroups(args.model.solveGeometry, args.faceLabels, "fixed");
  const preservedGroups = buildFaceGroups(args.model.solveGeometry, args.faceLabels, "preserved");
  const obstacleGroups = buildFaceGroups(args.model.solveGeometry, args.faceLabels, "obstacle");
  const preservedRegions = [
    ...fixedGroups.map((faceIndices, index) => ({
      id: `fixed-${index + 1}`,
      faceIndices
    })),
    ...preservedGroups.map((faceIndices, index) => ({
      id: `preserved-${index + 1}`,
      faceIndices
    }))
  ];

  return {
    model: {
      format: args.model.format,
      dataBase64: args.model.dataBase64
    },
    units: args.units,
    designRegion: {
      faceIndices:
        design.length > 0
          ? design
          : args.faceLabels
              .map((_, idx) => idx)
              .filter((idx) => !preserved.includes(idx) && !fixed.includes(idx))
    },
    preservedRegions,
    obstacleRegions: obstacle.length
      ? obstacleGroups.map((faceIndices, index) => ({
          id: `obstacle-${index + 1}`,
          faceIndices
        }))
      : [],
    loadCases: [
      {
        id: "LC-1",
        fixedRegions: fixedGroups.map((_, index) => `fixed-${index + 1}`),
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
