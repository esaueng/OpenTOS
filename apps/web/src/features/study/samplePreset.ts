import * as THREE from "three";

import type { ForceState, RegionLabel, UploadedModel } from "../../types";

export interface SamplePreset {
  labels: RegionLabel[];
  force: ForceState;
}

export function buildSamplePreset(model: UploadedModel): SamplePreset {
  const geometry = model.geometry.index ? model.geometry.toNonIndexed() : model.geometry;
  const positions = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const size = bounds.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const min = [bounds.min.x, bounds.min.y, bounds.min.z][axis];
  const max = [bounds.max.x, bounds.max.y, bounds.max.z][axis];
  const threshold = (max - min) * 0.18;
  const labels: RegionLabel[] = [];

  for (let face = 0; face < positions.count / 3; face += 1) {
    const center = (
      [positions.getX(face * 3), positions.getY(face * 3), positions.getZ(face * 3)][axis] +
      [positions.getX(face * 3 + 1), positions.getY(face * 3 + 1), positions.getZ(face * 3 + 1)][axis] +
      [positions.getX(face * 3 + 2), positions.getY(face * 3 + 2), positions.getZ(face * 3 + 2)][axis]
    ) / 3;
    labels.push(center <= min + threshold ? "fixed" : center >= max - threshold ? "preserved" : "design");
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const point: [number, number, number] = [center.x, center.y, center.z];
  point[axis] = max;
  const normal: [number, number, number] = [0, 0, 0];
  normal[axis] = 1;
  const direction: [number, number, number] = axis === 1 ? [1, 0, 0] : [0, -1, 0];

  return {
    labels,
    force: {
      id: "F-1",
      loadCaseId: "LC-1",
      point,
      normal,
      direction,
      magnitude: 1200,
      unit: "N",
      label: "F-1 (1200 N)"
    }
  };
}
