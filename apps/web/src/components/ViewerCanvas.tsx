import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Environment, Grid, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from "three-mesh-bvh";

import type { ForceState, RegionLabel } from "../types";

(THREE.Mesh as unknown as { prototype: { raycast: (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void } }).prototype.raycast = acceleratedRaycast;
(THREE.BufferGeometry as unknown as { prototype: Record<string, unknown> }).prototype.computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry as unknown as { prototype: Record<string, unknown> }).prototype.disposeBoundsTree = disposeBoundsTree;

const LABEL_COLORS: Record<RegionLabel, THREE.ColorRepresentation> = {
  preserved: "#35d07f",
  design: "#8a95ad",
  unassigned: "#526071"
};

interface ViewerCanvasProps {
  geometry: THREE.BufferGeometry | null;
  faceLabels: RegionLabel[];
  paintLabel: RegionLabel | null;
  brushRadius: number;
  onPaintFaces: (faceIndices: number[]) => void;
  placeForceMode: boolean;
  onPlaceForce: (point: [number, number, number], normal: [number, number, number]) => void;
  forces: ForceState[];
  selectedForceId: string | null;
  onSelectForce: (forceId: string | null) => void;
  outcomeObject: THREE.Object3D | null;
  showOriginal: boolean;
  showOutcomeOverlay: boolean;
  wireframe: boolean;
}

interface EditablePartProps {
  geometry: THREE.BufferGeometry;
  faceLabels: RegionLabel[];
  paintLabel: RegionLabel | null;
  brushRadius: number;
  onPaintFaces: (faceIndices: number[]) => void;
  placeForceMode: boolean;
  onPlaceForce: (point: [number, number, number], normal: [number, number, number]) => void;
}

type SurfaceGrowData = {
  faceNormals: THREE.Vector3[];
  adjacency: number[][];
};

function quantizedVertexKey(x: number, y: number, z: number): string {
  const q = 1e5;
  return `${Math.round(x * q)}:${Math.round(y * q)}:${Math.round(z * q)}`;
}

function EditablePart({
  geometry,
  faceLabels,
  paintLabel,
  brushRadius,
  onPaintFaces,
  placeForceMode,
  onPlaceForce
}: EditablePartProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isPainting, setIsPainting] = useState(false);

  const editableGeometry = useMemo(() => {
    const local = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    local.computeVertexNormals();
    (local as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
    return local;
  }, [geometry]);

  const faceCount = useMemo(
    () => editableGeometry.attributes.position.count / 3,
    [editableGeometry]
  );

  const faceCenters = useMemo(() => {
    const centers: THREE.Vector3[] = [];
    const pos = editableGeometry.attributes.position;
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    for (let i = 0; i < faceCount; i += 1) {
      vA.fromBufferAttribute(pos, i * 3);
      vB.fromBufferAttribute(pos, i * 3 + 1);
      vC.fromBufferAttribute(pos, i * 3 + 2);
      centers.push(new THREE.Vector3().add(vA).add(vB).add(vC).multiplyScalar(1 / 3));
    }
    return centers;
  }, [editableGeometry, faceCount]);

  const surfaceGrowData = useMemo<SurfaceGrowData>(() => {
    const pos = editableGeometry.attributes.position;
    const faceNormals = Array.from({ length: faceCount }, () => new THREE.Vector3(0, 0, 1));
    const adjacency = Array.from({ length: faceCount }, () => [] as number[]);
    const edgeMap = new Map<string, number[]>();

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();

    for (let faceIdx = 0; faceIdx < faceCount; faceIdx += 1) {
      const i0 = faceIdx * 3;
      const i1 = i0 + 1;
      const i2 = i0 + 2;

      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const n = new THREE.Vector3().crossVectors(ab, ac);
      if (n.lengthSq() > 1e-12) {
        n.normalize();
      } else {
        n.set(0, 0, 1);
      }
      faceNormals[faceIdx] = n;

      const k0 = quantizedVertexKey(a.x, a.y, a.z);
      const k1 = quantizedVertexKey(b.x, b.y, b.z);
      const k2 = quantizedVertexKey(c.x, c.y, c.z);
      const edges: [string, string][] = [
        [k0, k1],
        [k1, k2],
        [k2, k0]
      ];

      for (const [u, v] of edges) {
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        const faces = edgeMap.get(key);
        if (faces) {
          faces.push(faceIdx);
        } else {
          edgeMap.set(key, [faceIdx]);
        }
      }
    }

    edgeMap.forEach((faces) => {
      if (faces.length < 2) {
        return;
      }
      for (let i = 0; i < faces.length; i += 1) {
        for (let j = i + 1; j < faces.length; j += 1) {
          const f0 = faces[i];
          const f1 = faces[j];
          adjacency[f0].push(f1);
          adjacency[f1].push(f0);
        }
      }
    });

    return { faceNormals, adjacency };
  }, [editableGeometry, faceCount]);

  const brushRadiusWorld = useMemo(() => {
    editableGeometry.computeBoundingBox();
    const box = editableGeometry.boundingBox;
    if (!box) {
      return 0.05;
    }
    const diagonal = box.max.clone().sub(box.min).length();
    return Math.max(diagonal * brushRadius, diagonal * 0.01);
  }, [brushRadius, editableGeometry]);

  useEffect(() => {
    const posCount = editableGeometry.attributes.position.count;
    const colors = new Float32Array(posCount * 3);
    const color = new THREE.Color();

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const label = faceLabels[faceIndex] ?? "design";
      color.set(LABEL_COLORS[label]);
      for (let localVertex = 0; localVertex < 3; localVertex += 1) {
        const vertexIndex = faceIndex * 3 + localVertex;
        colors[vertexIndex * 3] = color.r;
        colors[vertexIndex * 3 + 1] = color.g;
        colors[vertexIndex * 3 + 2] = color.b;
      }
    }

    editableGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    editableGeometry.attributes.color.needsUpdate = true;
  }, [editableGeometry, faceCount, faceLabels]);

  useEffect(() => {
    return () => {
      (editableGeometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
      editableGeometry.dispose();
    };
  }, [editableGeometry]);

  const paint = (event: ThreeEvent<PointerEvent>) => {
    if (!paintLabel || placeForceMode) {
      return;
    }

    const faceIndex = event.faceIndex;
    if (faceIndex == null || faceIndex < 0 || faceIndex >= faceCenters.length) {
      return;
    }

    const origin = faceCenters[faceIndex];
    const targets: number[] = [];

    for (let i = 0; i < faceCenters.length; i += 1) {
      if (origin.distanceTo(faceCenters[i]) <= brushRadiusWorld) {
        targets.push(i);
      }
    }

    onPaintFaces(targets);
  };

  const selectContiguousSurface = (startFaceIndex: number): number[] => {
    const { faceNormals, adjacency } = surfaceGrowData;
    if (startFaceIndex < 0 || startFaceIndex >= faceNormals.length) {
      return [];
    }

    const visited = new Uint8Array(faceNormals.length);
    const queue: number[] = [startFaceIndex];
    const selected: number[] = [];
    const cosineThreshold = Math.cos(THREE.MathUtils.degToRad(34));

    visited[startFaceIndex] = 1;

    while (queue.length > 0) {
      const current = queue.pop()!;
      selected.push(current);

      const currentNormal = faceNormals[current];
      for (const next of adjacency[current]) {
        if (visited[next]) {
          continue;
        }

        const dot = currentNormal.dot(faceNormals[next]);
        if (dot >= cosineThreshold) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    return selected;
  };

  const placeForce = (event: ThreeEvent<MouseEvent>) => {
    if (!placeForceMode) {
      return;
    }

    const point = event.point;
    const faceNormal = event.face?.normal
      ? event.face.normal.clone().transformDirection(event.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 0, 1);

    onPlaceForce(
      [point.x, point.y, point.z],
      [faceNormal.x, faceNormal.y, faceNormal.z]
    );
  };

  return (
    <mesh
      ref={meshRef}
      geometry={editableGeometry}
      onPointerDown={(event) => {
        if (!placeForceMode && paintLabel) {
          if (paintLabel === "preserved") {
            const faceIndex = event.faceIndex;
            if (faceIndex != null && faceIndex >= 0 && faceIndex < faceCount) {
              onPaintFaces(selectContiguousSurface(faceIndex));
            }
            return;
          }

          setIsPainting(true);
          paint(event);
        }
      }}
      onPointerMove={(event) => {
        if (isPainting) {
          paint(event);
        }
      }}
      onPointerUp={() => setIsPainting(false)}
      onPointerLeave={() => setIsPainting(false)}
      onClick={placeForce}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color="#8a95ad"
        metalness={0.25}
        roughness={0.45}
        vertexColors
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

function ForceArrow({
  force,
  selected,
  onSelect
}: {
  force: ForceState;
  selected: boolean;
  onSelect: () => void;
}) {
  const length = Math.min(Math.max(force.magnitude * 0.01, 0.08), 0.35);
  const direction = useMemo(() => new THREE.Vector3(...force.direction).normalize(), [force.direction]);
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    return q;
  }, [direction]);

  return (
    <group
      position={new THREE.Vector3(...force.point)}
      quaternion={quaternion}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, length * 0.45, 0]}>
        <cylinderGeometry args={[0.005, 0.005, length * 0.9, 8]} />
        <meshStandardMaterial color={selected ? "#ffd166" : "#ef476f"} emissive={selected ? "#553100" : "#2f0d16"} />
      </mesh>
      <mesh position={[0, length * 0.95, 0]}>
        <coneGeometry args={[0.016, length * 0.2, 10]} />
        <meshStandardMaterial color={selected ? "#ffd166" : "#ef476f"} emissive={selected ? "#553100" : "#2f0d16"} />
      </mesh>
      <Html position={[0, length * 1.15, 0]} center>
        <span className="force-label">{force.label}</span>
      </Html>
    </group>
  );
}

function OutcomeOverlay({ object, wireframe }: { object: THREE.Object3D; wireframe: boolean }) {
  const cloned = useMemo(() => object.clone(true), [object]);

  useEffect(() => {
    cloned.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material) {
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        material.wireframe = wireframe;
        material.transparent = true;
        material.opacity = 0.85;
        material.needsUpdate = true;
      }
    });
  }, [cloned, wireframe]);

  return <primitive object={cloned} />;
}

export function ViewerCanvas({
  geometry,
  faceLabels,
  paintLabel,
  brushRadius,
  onPaintFaces,
  placeForceMode,
  onPlaceForce,
  forces,
  selectedForceId,
  onSelectForce,
  outcomeObject,
  showOriginal,
  showOutcomeOverlay,
  wireframe
}: ViewerCanvasProps) {
  return (
    <div className="viewer-shell">
      <Canvas camera={{ fov: 42, position: [1.2, 1.2, 1.2] }} shadows>
        <color attach="background" args={["#081223"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
        <Bounds fit clip observe margin={1.25}>
          <group onClick={() => onSelectForce(null)}>
            {geometry && showOriginal && (
              <EditablePart
                geometry={geometry}
                faceLabels={faceLabels}
                paintLabel={paintLabel}
                brushRadius={brushRadius}
                onPaintFaces={onPaintFaces}
                placeForceMode={placeForceMode}
                onPlaceForce={onPlaceForce}
              />
            )}
            {outcomeObject && showOutcomeOverlay && (
              <OutcomeOverlay object={outcomeObject} wireframe={wireframe} />
            )}
            {forces.map((force) => (
              <ForceArrow
                key={force.id}
                force={force}
                selected={force.id === selectedForceId}
                onSelect={() => onSelectForce(force.id)}
              />
            ))}
          </group>
        </Bounds>
        <Grid args={[4, 4]} infiniteGrid cellColor="#2f3b50" sectionColor="#4f6285" fadeDistance={14} />
        <Environment preset="city" />
        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}
