import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildSurfaceTopology, resolvePreservedSurfaceSelection, selectContiguousSurface } from "./selection";
function washerGeometry() {
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
function averageNormal(topology, faces) {
    const normal = new THREE.Vector3();
    for (const faceIndex of faces) {
        normal.add(topology.faceNormals[faceIndex]);
    }
    return normal.normalize();
}
describe("preserved surface selection", () => {
    it("redirects hole clicks from annulus caps to the inner wall", () => {
        const geometry = washerGeometry();
        const topology = buildSurfaceTopology(geometry);
        let annulusFace = -1;
        for (let i = 0; i < topology.faceCenters.length; i += 1) {
            const center = topology.faceCenters[i];
            const radial = Math.hypot(center.x, center.y);
            if (center.z < 0.01 && radial > 0.55 && radial < 0.85 && topology.faceNormals[i].z < -0.98) {
                annulusFace = i;
                break;
            }
        }
        expect(annulusFace).toBeGreaterThanOrEqual(0);
        const baseSurface = selectContiguousSurface(annulusFace, topology);
        const redirectedSurface = resolvePreservedSurfaceSelection(annulusFace, topology, new THREE.Ray(new THREE.Vector3(0.2, 0, 1.5), new THREE.Vector3(0, 0, -1)));
        const baseNormal = averageNormal(topology, baseSurface);
        const redirectedNormal = averageNormal(topology, redirectedSurface);
        expect(Math.abs(baseNormal.z)).toBeGreaterThan(0.95);
        expect(Math.abs(redirectedNormal.z)).toBeLessThan(0.35);
        expect(redirectedSurface).not.toEqual(baseSurface);
    });
});
