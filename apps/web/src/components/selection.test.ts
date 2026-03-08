import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildSurfaceTopology,
  resolvePreservedSurfaceSelection,
  resolvePreservedSurfaceSelectionFromCandidates,
  selectConnectedLabeledFaces,
  selectContiguousSurface
} from "./selection";

function washerGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1, 0, Math.PI * 2, false);

  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.45, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.4,
    bevelEnabled: false,
    curveSegments: 32
  });
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function dumbbellGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1, 0.5);
  shape.absarc(-1, 0, 0.5, Math.PI / 2, -Math.PI / 2, true);
  shape.lineTo(1, -0.5);
  shape.absarc(1, 0, 0.5, -Math.PI / 2, Math.PI / 2, true);
  shape.lineTo(-1, 0.5);

  const leftHole = new THREE.Path();
  leftHole.absarc(-1, 0, 0.2, 0, Math.PI * 2, true);
  shape.holes.push(leftHole);

  const rightHole = new THREE.Path();
  rightHole.absarc(1, 0, 0.2, 0, Math.PI * 2, true);
  shape.holes.push(rightHole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.25,
    bevelEnabled: false,
    curveSegments: 32
  });
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function averageNormal(topology: ReturnType<typeof buildSurfaceTopology>, faces: number[]): THREE.Vector3 {
  const normal = new THREE.Vector3();
  for (const faceIndex of faces) {
    normal.add(topology.faceNormals[faceIndex]);
  }
  return normal.normalize();
}

describe("preserved surface selection", () => {
  function findAnnulusFace(topology: ReturnType<typeof buildSurfaceTopology>): number {
    for (let i = 0; i < topology.faceCenters.length; i += 1) {
      const center = topology.faceCenters[i];
      const radial = Math.hypot(center.x, center.y);
      if (center.z < 0.01 && radial > 0.55 && radial < 0.85 && topology.faceNormals[i].z < -0.98) {
        return i;
      }
    }
    return -1;
  }

  function findCapFaceNearPoint(
    topology: ReturnType<typeof buildSurfaceTopology>,
    point: [number, number, number]
  ): number {
    let bestFace = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < topology.faceCenters.length; i += 1) {
      const center = topology.faceCenters[i];
      if (Math.abs(topology.faceNormals[i].z) < 0.98) {
        continue;
      }
      const dx = center.x - point[0];
      const dy = center.y - point[1];
      const dz = center.z - point[2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFace = i;
      }
    }
    return bestFace;
  }

  it("redirects hole clicks from annulus caps to the inner wall", () => {
    const geometry = washerGeometry();
    const topology = buildSurfaceTopology(geometry);
    const annulusFace = findAnnulusFace(topology);

    expect(annulusFace).toBeGreaterThanOrEqual(0);

    const baseSurface = selectContiguousSurface(annulusFace, topology);
    const redirectedSurface = resolvePreservedSurfaceSelection(
      annulusFace,
      topology,
      new THREE.Ray(new THREE.Vector3(0.2, 0, 1.5), new THREE.Vector3(0, 0, -1))
    );

    const baseNormal = averageNormal(topology, baseSurface);
    const redirectedNormal = averageNormal(topology, redirectedSurface);

    expect(Math.abs(baseNormal.z)).toBeGreaterThan(0.95);
    expect(Math.abs(redirectedNormal.z)).toBeLessThan(0.35);
    expect(redirectedSurface).not.toEqual(baseSurface);
  });

  it("uses ordered hit candidates and still resolves the bore wall", () => {
    const geometry = washerGeometry();
    const topology = buildSurfaceTopology(geometry);
    const annulusFace = findAnnulusFace(topology);

    const redirectedSurface = resolvePreservedSurfaceSelectionFromCandidates(
      [annulusFace, annulusFace + 1, annulusFace + 2],
      topology,
      new THREE.Ray(new THREE.Vector3(0.18, 0, 1.5), new THREE.Vector3(0, 0, -1))
    );

    const redirectedNormal = averageNormal(topology, redirectedSurface);
    expect(Math.abs(redirectedNormal.z)).toBeLessThan(0.35);
  });

  it("treats clicks on the hole rim as part of the hole selection", () => {
    const geometry = washerGeometry();
    const topology = buildSurfaceTopology(geometry);
    const annulusFace = findAnnulusFace(topology);

    const redirectedSurface = resolvePreservedSurfaceSelection(
      annulusFace,
      topology,
      new THREE.Ray(new THREE.Vector3(0.45, 0, 1.5), new THREE.Vector3(0, 0, -1))
    );

    const redirectedNormal = averageNormal(topology, redirectedSurface);
    expect(Math.abs(redirectedNormal.z)).toBeLessThan(0.35);
  });

  it("clears the currently preserved connected component under the cursor", () => {
    const geometry = washerGeometry();
    const topology = buildSurfaceTopology(geometry);
    const annulusFace = findAnnulusFace(topology);
    const redirectedSurface = resolvePreservedSurfaceSelection(
      annulusFace,
      topology,
      new THREE.Ray(new THREE.Vector3(0.2, 0, 1.5), new THREE.Vector3(0, 0, -1))
    );

    const labels = Array.from({ length: topology.faceCenters.length }, () => "design");
    for (const faceIndex of redirectedSurface) {
      labels[faceIndex] = "preserved";
    }

    const clearedSurface = selectConnectedLabeledFaces(redirectedSurface[0], topology, labels, "preserved");
    expect(new Set(clearedSurface)).toEqual(new Set(redirectedSurface));
  });

  it("keeps left annulus clicks on the left hole instead of leaking to the right side", () => {
    const geometry = dumbbellGeometry();
    const topology = buildSurfaceTopology(geometry);
    const leftAnnulusFace = findCapFaceNearPoint(topology, [-1.32, 0, 0]);

    expect(leftAnnulusFace).toBeGreaterThanOrEqual(0);

    const redirectedSurface = resolvePreservedSurfaceSelection(
      leftAnnulusFace,
      topology,
      new THREE.Ray(new THREE.Vector3(-1.32, 0, 1.5), new THREE.Vector3(0, 0, -1))
    );

    const xs = redirectedSurface.map((faceIndex) => topology.faceCenters[faceIndex].x);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(0);
  });
});
