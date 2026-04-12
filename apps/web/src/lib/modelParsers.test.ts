import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { collectMergedSceneGeometry } from "./modelParsers";

describe("model parser scene flattening", () => {
  it("merges multiple transformed meshes into one solve geometry", () => {
    const root = new THREE.Group();

    const left = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
    left.position.set(-2, 0, 0);
    root.add(left);

    const rightParent = new THREE.Group();
    rightParent.position.set(1.5, 0, 0);
    rightParent.rotation.set(0, Math.PI / 2, 0);

    const right = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.5).toNonIndexed());
    right.position.set(0.5, 0, 0);
    rightParent.add(right);
    root.add(rightParent);

    const merged = collectMergedSceneGeometry(root);
    expect(merged).not.toBeNull();

    const geometry = merged!;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    expect(geometry.getAttribute("position").count).toBe(
      left.geometry.getAttribute("position").count + right.geometry.getAttribute("position").count
    );
    expect(box.min.x).toBeLessThan(-2.4);
    expect(box.max.x).toBeGreaterThan(1.2);
    expect(box.max.z - box.min.z).toBeGreaterThan(1.8);
  });
});
