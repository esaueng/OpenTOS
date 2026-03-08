import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from "three-mesh-bvh";

import type { ForceState, RegionLabel } from "../types";
import { buildSurfaceTopology, resolvePreservedSurfaceSelection } from "./selection";

(THREE.Mesh as unknown as { prototype: { raycast: (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void } }).prototype.raycast = acceleratedRaycast;
(THREE.BufferGeometry as unknown as { prototype: Record<string, unknown> }).prototype.computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry as unknown as { prototype: Record<string, unknown> }).prototype.disposeBoundsTree = disposeBoundsTree;

const LABEL_COLORS: Record<RegionLabel, THREE.ColorRepresentation> = {
  preserved: "#35d07f",
  fixed: "#35d07f",
  obstacle: "#f59e0b",
  design: "#8a95ad",
  unassigned: "#526071"
};

interface ViewerCanvasProps {
  geometry: THREE.BufferGeometry | null;
  faceLabels: RegionLabel[];
  paintLabel: RegionLabel | null;
  brushRadius: number;
  onPaintFaces: (faceIndices: number[], label: RegionLabel) => void;
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
  onPaintFaces: (faceIndices: number[], label: RegionLabel) => void;
  placeForceMode: boolean;
  onPlaceForce: (point: [number, number, number], normal: [number, number, number]) => void;
}

interface CameraAutoFitProps {
  fitRootRef: React.RefObject<THREE.Group>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  fitKey: string;
}

function CameraAutoFit({ fitRootRef, controlsRef, fitKey }: CameraAutoFitProps) {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    const root = fitRootRef.current;
    if (!root) {
      return;
    }

    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1e-4);

    camera.near = Math.max(radius / 5000, 1e-6);
    camera.far = Math.max(radius * 5000, 1000);
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(center);
      controls.minDistance = Math.max(radius * 0.01, 1e-5);
      controls.maxDistance = Math.max(radius * 10000, controls.minDistance * 1000);

      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() <= 1e-12) {
        dir.set(1, 0.6, 1);
      }
      dir.normalize();
      const targetDistance = Math.max(radius * 2.8, controls.minDistance * 2);
      camera.position.copy(center).addScaledVector(dir, targetDistance);
      controls.update();
    } else {
      camera.position.set(center.x + radius * 2.2, center.y + radius * 1.4, center.z + radius * 2.2);
      camera.lookAt(center);
    }

    invalidate();
  }, [camera, controlsRef, fitKey, fitRootRef, invalidate]);

  return null;
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

  const surfaceTopology = useMemo(() => buildSurfaceTopology(editableGeometry), [editableGeometry]);

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
    if (faceIndex == null || faceIndex < 0 || faceIndex >= surfaceTopology.faceCenters.length) {
      return;
    }

    const origin = surfaceTopology.faceCenters[faceIndex];
    const targets: number[] = [];

    for (let i = 0; i < surfaceTopology.faceCenters.length; i += 1) {
      if (origin.distanceTo(surfaceTopology.faceCenters[i]) <= brushRadiusWorld) {
        targets.push(i);
      }
    }

    onPaintFaces(targets, paintLabel);
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
            if (event.button !== 0 && event.button !== 2) {
              return;
            }
            event.stopPropagation();
            event.nativeEvent.preventDefault();
            const faceIndex = event.faceIndex;
            if (faceIndex != null && faceIndex >= 0 && faceIndex < faceCount) {
              const label = event.button === 2 ? "design" : "preserved";
              onPaintFaces(
                resolvePreservedSurfaceSelection(faceIndex, surfaceTopology, event.ray.clone()),
                label
              );
            }
            return;
          }

          if (event.button !== 0) {
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
      onContextMenu={(event) => {
        if (paintLabel === "preserved") {
          event.stopPropagation();
          event.nativeEvent.preventDefault();
        }
      }}
      onClick={placeForce}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color="#8a95ad"
        metalness={0.08}
        roughness={0.7}
        vertexColors
        side={THREE.DoubleSide}
        transparent={false}
        depthWrite
        depthTest
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
        const source = Array.isArray(node.material) ? node.material[0] : node.material;
        const material = source.clone();
        material.wireframe = wireframe;

        if (node.name === "preserved") {
          material.color = new THREE.Color("#35d07f");
          material.transparent = false;
          material.opacity = 1;
          material.metalness = 0.1;
          material.roughness = 0.72;
        } else {
          material.color = new THREE.Color("#2f353d");
          material.transparent = false;
          material.opacity = 1;
          material.metalness = 0.18;
          material.roughness = 0.62;
          material.emissive = new THREE.Color("#0f141b");
          material.emissiveIntensity = 0.03;
        }
        material.side = THREE.DoubleSide;
        material.depthWrite = true;
        material.depthTest = true;

        material.needsUpdate = true;
        node.material = material;
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
  const fitRootRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const fitKey = `${geometry?.uuid ?? "no-geometry"}:${showOriginal}:${outcomeObject?.uuid ?? "no-outcome"}:${showOutcomeOverlay}`;

  return (
    <div className="viewer-shell">
      <Canvas camera={{ fov: 42, near: 1e-6, far: 1e9, position: [1.2, 1.2, 1.2] }} shadows onPointerMissed={() => onSelectForce(null)}>
        <color attach="background" args={["#081223"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
        <group ref={fitRootRef} onClick={() => onSelectForce(null)}>
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
        </group>
        {forces.map((force) => (
          <ForceArrow
            key={force.id}
            force={force}
            selected={force.id === selectedForceId}
            onSelect={() => onSelectForce(force.id)}
          />
        ))}
        <CameraAutoFit fitRootRef={fitRootRef} controlsRef={controlsRef} fitKey={fitKey} />
        <Environment preset="city" />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          minDistance={1e-5}
          maxDistance={1e12}
          zoomSpeed={1}
          panSpeed={0.9}
        />
      </Canvas>
    </div>
  );
}
