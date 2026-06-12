import type { FaceRegion } from "@contracts/index";
import type * as THREE from "three";

import type { BuildSolvePayloadArgs, LoadCaseState, RegionLabel, SolvePayload } from "../types";

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

function faceIndicesMatching(labels: RegionLabel[], matches: (label: RegionLabel) => boolean): number[] {
  const out: number[] = [];
  for (let idx = 0; idx < labels.length; idx += 1) {
    if (matches(labels[idx])) {
      out.push(idx);
    }
  }
  return out;
}

export function getPreservedFaceIndices(labels: RegionLabel[]): number[] {
  return faceIndicesMatching(labels, (label) => label === "preserved");
}

export function getFixedFaceIndices(labels: RegionLabel[]): number[] {
  return faceIndicesMatching(labels, (label) => label === "fixed");
}

export function getObstacleFaceIndices(labels: RegionLabel[]): number[] {
  return faceIndicesMatching(labels, (label) => label === "obstacle");
}

export function getDesignFaceIndices(labels: RegionLabel[]): number[] {
  return faceIndicesMatching(labels, (label) => label === "design" || label === "unassigned");
}

/**
 * Returns the next id of the form `${prefix}-${n}` that does not collide with
 * any existing id. Array length is not a safe source for `n`: deleting an
 * entry and adding a new one would mint a duplicate id.
 */
export function nextSequentialId(existingIds: string[], prefix: string): string {
  let maxSeen = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existingIds) {
    const match = pattern.exec(id);
    if (match) {
      maxSeen = Math.max(maxSeen, Number(match[1]));
    }
  }
  return `${prefix}-${maxSeen + 1}`;
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

export function buildConstraintGroups(
  geometry: THREE.BufferGeometry,
  labels: RegionLabel[]
): {
  fixedRegions: FaceRegion[];
  preservedRegions: FaceRegion[];
  obstacleRegions: FaceRegion[];
} {
  // Region ids are keyed by the group's smallest face index, not its position
  // in the group list. Positional ids ("fixed-1", "fixed-2") silently remap
  // load-case references whenever painting adds or removes a group earlier in
  // face order; min-face ids stay stable for groups that did not change.
  const fixedRegions = buildFaceGroups(geometry, labels, "fixed").map((faceIndices) => ({
    id: `fixed-${faceIndices[0]}`,
    faceIndices
  }));
  const preservedRegions = buildFaceGroups(geometry, labels, "preserved").map((faceIndices) => ({
    id: `preserved-${faceIndices[0]}`,
    faceIndices
  }));
  const obstacleRegions = buildFaceGroups(geometry, labels, "obstacle").map((faceIndices) => ({
    id: `obstacle-${faceIndices[0]}`,
    faceIndices
  }));

  return {
    fixedRegions,
    preservedRegions,
    obstacleRegions
  };
}

function fallbackDesignFaceIndices(labels: RegionLabel[], preserved: number[], fixed: number[]): number[] {
  const excluded = new Set<number>([...preserved, ...fixed]);
  const out: number[] = [];
  for (let idx = 0; idx < labels.length; idx += 1) {
    if (!excluded.has(idx)) {
      out.push(idx);
    }
  }
  return out;
}

export function buildActiveLoadCases(
  loadCases: LoadCaseState[],
  forces: BuildSolvePayloadArgs["forces"],
  fixedRegions: FaceRegion[]
): SolvePayload["loadCases"] {
  const validFixedRegionIds = new Set(fixedRegions.map((region) => region.id));
  return loadCases
    .map((loadCase) => ({
      id: loadCase.id,
      fixedRegions: loadCase.fixedRegionIds.filter((regionId) => validFixedRegionIds.has(regionId)),
      forces: forces.filter((force) => force.loadCaseId === loadCase.id)
    }))
    .filter((loadCase) => loadCase.forces.length > 0);
}

export function buildSolvePayload(args: BuildSolvePayloadArgs): SolvePayload {
  const preserved = getPreservedFaceIndices(args.faceLabels);
  const fixed = getFixedFaceIndices(args.faceLabels);
  const design = getDesignFaceIndices(args.faceLabels);
  const obstacle = getObstacleFaceIndices(args.faceLabels);
  const groups = buildConstraintGroups(args.model.solveGeometry, args.faceLabels);
  const preservedRegions = [...groups.fixedRegions, ...groups.preservedRegions];
  const requestedLoadCases = args.loadCases.length > 0 ? args.loadCases : [{ id: "LC-1", fixedRegionIds: [] }];
  const activeLoadCases = buildActiveLoadCases(requestedLoadCases, args.forces, groups.fixedRegions);

  return {
    model: {
      format: args.model.format,
      dataBase64: args.model.dataBase64
    },
    units: args.units,
    designRegion: {
      faceIndices: design.length > 0 ? design : fallbackDesignFaceIndices(args.faceLabels, preserved, fixed)
    },
    preservedRegions,
    obstacleRegions: obstacle.length ? groups.obstacleRegions : [],
    loadCases: activeLoadCases.map((loadCase) => ({
      id: loadCase.id,
      fixedRegions: loadCase.fixedRegions,
      forces: loadCase.forces.map((force) => ({
        point: mapDisplayPointToSolve(force.point, args.model.solveToDisplayOffset),
        direction: normalizeDirection(force.direction),
        magnitude: force.magnitude,
        unit: force.unit,
        label: force.label
      }))
    })),
    material: args.material,
    targets: {
      safetyFactor: args.targetSafetyFactor,
      outcomeCount: args.outcomeCount,
      massReductionGoalPct: args.massReductionGoalPct
    }
  };
}
