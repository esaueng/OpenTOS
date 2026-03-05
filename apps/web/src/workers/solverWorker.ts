/// <reference lib="webworker" />

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Outcome, SolveRequest } from "@contracts/index";

type WorkerInMessage = {
  type: "solve";
  payload: SolveRequest;
};

type WorkerProgressMessage = {
  type: "progress";
  stage: "queued" | "parse" | "voxelize" | "field-solve" | "variant-synth" | "export" | "complete";
  progress: number;
  status: "queued" | "running" | "succeeded";
};

type WorkerResultMessage = {
  type: "result";
  outcomes: Outcome[];
};

type WorkerErrorMessage = {
  type: "error";
  error: string;
};

type WorkerOutMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

type ForceVec = {
  point: THREE.Vector3;
  direction: THREE.Vector3;
  magnitudeN: number;
};

const UNIT_TO_METERS: Record<SolveRequest["units"], number> = {
  mm: 0.001,
  in: 0.0254,
  m: 1.0
};

const FORCE_TO_NEWTONS: Record<"N" | "lb", number> = {
  N: 1,
  lb: 4.4482216152605
};

function postMessageTyped(message: WorkerOutMessage): void {
  self.postMessage(message);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToB64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function findMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry instanceof THREE.BufferGeometry) {
      meshes.push(node);
    }
  });
  return meshes;
}

function toNonIndexedGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  copy.computeVertexNormals();
  return copy;
}

async function parseInputGeometry(model: SolveRequest["model"]): Promise<THREE.BufferGeometry> {
  const raw = b64ToArrayBuffer(model.dataBase64);

  if (model.format === "stl") {
    const loader = new STLLoader();
    return toNonIndexedGeometry(loader.parse(raw));
  }

  if (model.format === "obj") {
    const text = new TextDecoder().decode(raw);
    const loader = new OBJLoader();
    const root = loader.parse(text);
    const meshes = findMeshes(root);
    if (!meshes.length) {
      throw new Error("OBJ model contains no mesh geometry");
    }

    const geos = meshes.map((mesh) => mesh.geometry.clone());
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) {
      throw new Error("Failed to merge OBJ mesh geometry");
    }
    return toNonIndexedGeometry(merged);
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(raw, "");
  const meshes = findMeshes(gltf.scene);
  if (!meshes.length) {
    throw new Error("GLB model contains no mesh geometry");
  }

  const geos = meshes.map((mesh) => mesh.geometry.clone());
  const merged = BufferGeometryUtils.mergeGeometries(geos, false);
  if (!merged) {
    throw new Error("Failed to merge GLB mesh geometry");
  }
  return toNonIndexedGeometry(merged);
}

function normalizeForces(request: SolveRequest): ForceVec[] {
  return request.forces.map((force) => {
    const direction = new THREE.Vector3(force.direction[0], force.direction[1], force.direction[2]);
    if (direction.lengthSq() <= 1e-12) {
      direction.set(0, 0, 1);
    } else {
      direction.normalize();
    }

    return {
      point: new THREE.Vector3(force.point[0], force.point[1], force.point[2]),
      direction,
      magnitudeN: force.magnitude * FORCE_TO_NEWTONS[force.unit]
    };
  });
}

function faceCount(geometry: THREE.BufferGeometry): number {
  return Math.floor(geometry.attributes.position.count / 3);
}

function getPreservedFaceSet(request: SolveRequest, totalFaces: number): Set<number> {
  const preserved = new Set<number>();
  for (const region of request.preservedRegions) {
    for (const idx of region.faceIndices) {
      if (idx >= 0 && idx < totalFaces) {
        preserved.add(idx);
      }
    }
  }
  return preserved;
}

function faceCenter(positions: Float32Array, faceIndex: number): THREE.Vector3 {
  const base = faceIndex * 9;
  return new THREE.Vector3(
    (positions[base] + positions[base + 3] + positions[base + 6]) / 3,
    (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3,
    (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3
  );
}

function faceArea(positions: Float32Array, faceIndex: number): number {
  const i = faceIndex * 9;
  const a = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
  const b = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
  const c = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  return 0.5 * ab.cross(ac).length();
}

function computeFaceInfluence(
  positions: Float32Array,
  totalFaces: number,
  preservedFaces: Set<number>,
  forces: ForceVec[],
  bbox: THREE.Box3
): Float32Array {
  const influence = new Float32Array(totalFaces);
  const diag = Math.max(bbox.min.distanceTo(bbox.max), 1e-6);
  const sigma = diag * 0.35;

  const preservedCenters: THREE.Vector3[] = [];
  preservedFaces.forEach((idx) => preservedCenters.push(faceCenter(positions, idx)));

  for (let faceIdx = 0; faceIdx < totalFaces; faceIdx += 1) {
    const c = faceCenter(positions, faceIdx);
    let score = 0;

    for (const force of forces) {
      const dv = c.clone().sub(force.point);
      const dist = dv.length();
      const dirAlignment = dist > 1e-9 ? Math.abs(dv.normalize().dot(force.direction)) : 1;
      const radial = Math.exp(-(dist * dist) / (2 * sigma * sigma));
      score += force.magnitudeN * radial * (0.35 + 0.65 * dirAlignment);
    }

    if (preservedCenters.length > 0) {
      let nearest = Number.POSITIVE_INFINITY;
      const stride = Math.max(1, Math.floor(preservedCenters.length / 180));
      for (let i = 0; i < preservedCenters.length; i += stride) {
        const d = c.distanceTo(preservedCenters[i]);
        if (d < nearest) {
          nearest = d;
        }
      }
      score += Math.exp(-nearest / (diag * 0.22));
    }

    if (preservedFaces.has(faceIdx)) {
      score += 4.0;
    }

    influence[faceIdx] = score;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < influence.length; i += 1) {
    min = Math.min(min, influence[i]);
    max = Math.max(max, influence[i]);
  }

  const range = Math.max(max - min, 1e-9);
  for (let i = 0; i < influence.length; i += 1) {
    influence[i] = (influence[i] - min) / range;
  }

  return influence;
}

function gatherPositionsByFaces(positions: Float32Array, faceIndices: number[]): Float32Array {
  const out = new Float32Array(faceIndices.length * 9);
  let cursor = 0;
  for (const faceIndex of faceIndices) {
    const src = faceIndex * 9;
    out[cursor] = positions[src];
    out[cursor + 1] = positions[src + 1];
    out[cursor + 2] = positions[src + 2];
    out[cursor + 3] = positions[src + 3];
    out[cursor + 4] = positions[src + 4];
    out[cursor + 5] = positions[src + 5];
    out[cursor + 6] = positions[src + 6];
    out[cursor + 7] = positions[src + 7];
    out[cursor + 8] = positions[src + 8];
    cursor += 9;
  }
  return out;
}

function smoothIndexedGeometry(geometry: THREE.BufferGeometry, iterations: number, alpha: number): void {
  const index = geometry.getIndex();
  const posAttr = geometry.getAttribute("position");
  if (!index || !posAttr || posAttr.itemSize !== 3) {
    return;
  }

  const positions = posAttr.array as Float32Array;
  const vertexCount = posAttr.count;
  const neighbors: number[][] = Array.from({ length: vertexCount }, () => []);

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);

    neighbors[a].push(b, c);
    neighbors[b].push(a, c);
    neighbors[c].push(a, b);
  }

  for (let it = 0; it < iterations; it += 1) {
    const next = new Float32Array(positions.length);
    for (let vi = 0; vi < vertexCount; vi += 1) {
      const n = neighbors[vi];
      const base = vi * 3;
      if (n.length === 0) {
        next[base] = positions[base];
        next[base + 1] = positions[base + 1];
        next[base + 2] = positions[base + 2];
        continue;
      }

      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const ni of n) {
        const nb = ni * 3;
        sx += positions[nb];
        sy += positions[nb + 1];
        sz += positions[nb + 2];
      }

      const inv = 1 / n.length;
      const ax = sx * inv;
      const ay = sy * inv;
      const az = sz * inv;

      next[base] = positions[base] * (1 - alpha) + ax * alpha;
      next[base + 1] = positions[base + 1] * (1 - alpha) + ay * alpha;
      next[base + 2] = positions[base + 2] * (1 - alpha) + az * alpha;
    }

    positions.set(next);
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

function computeVolumeFromGeometry(geometry: THREE.BufferGeometry): number {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position");
  if (!pos || pos.itemSize !== 3) {
    return 0;
  }

  const p = pos.array as Float32Array;
  let sum = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i];
    const ay = p[i + 1];
    const az = p[i + 2];
    const bx = p[i + 3];
    const by = p[i + 4];
    const bz = p[i + 5];
    const cx = p[i + 6];
    const cy = p[i + 7];
    const cz = p[i + 8];

    sum +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }

  return Math.abs(sum / 6);
}

function variantParams(index: number, count: number): { threshold: number; smoothIters: number; smoothAlpha: number; thickness: number } {
  const t = count <= 1 ? 0 : index / (count - 1);
  return {
    threshold: 0.38 + t * 0.28,
    smoothIters: 2 + (index % 3),
    smoothAlpha: 0.16 + (index % 4) * 0.045,
    thickness: 0.008 + (1 - t) * 0.016
  };
}

async function exportSceneToGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error("GLTFExporter did not return binary output"));
      },
      (err) => reject(err),
      { binary: true, onlyVisible: false }
    );
  });
}

function buildGeneratedGeometry(
  sourceNonIndexed: THREE.BufferGeometry,
  preservedFaces: Set<number>,
  influence: Float32Array,
  forceDirs: THREE.Vector3[],
  params: { threshold: number; smoothIters: number; smoothAlpha: number; thickness: number }
): { preserved: THREE.BufferGeometry; generated: THREE.BufferGeometry; keptFaceArea: number } {
  const positionsAttr = sourceNonIndexed.getAttribute("position");
  if (!positionsAttr || positionsAttr.itemSize !== 3) {
    throw new Error("Input geometry position attribute is invalid");
  }

  const positions = positionsAttr.array as Float32Array;
  const totalFaces = faceCount(sourceNonIndexed);

  const preservedFaceList: number[] = [];
  const keptDesignFaces: number[] = [];

  for (let faceIdx = 0; faceIdx < totalFaces; faceIdx += 1) {
    if (preservedFaces.has(faceIdx)) {
      preservedFaceList.push(faceIdx);
      continue;
    }

    const score = influence[faceIdx];
    const keep = score >= params.threshold || score >= params.threshold * 0.88 && (faceIdx % 7 === 0);
    if (keep) {
      keptDesignFaces.push(faceIdx);
    }
  }

  if (keptDesignFaces.length < 12) {
    // Ensure we always keep enough design triangles to remain inspectable.
    const sorted = Array.from({ length: totalFaces }, (_, i) => i)
      .filter((i) => !preservedFaces.has(i))
      .sort((a, b) => influence[b] - influence[a]);
    keptDesignFaces.push(...sorted.slice(0, Math.min(80, sorted.length)));
  }

  const uniqueDesignFaces = Array.from(new Set(keptDesignFaces));
  let keptFaceArea = 0;
  for (const faceIdx of uniqueDesignFaces) {
    keptFaceArea += faceArea(positions, faceIdx);
  }

  const preservedPos = gatherPositionsByFaces(positions, preservedFaceList);
  const generatedPos = gatherPositionsByFaces(positions, uniqueDesignFaces);

  const preserved = new THREE.BufferGeometry();
  preserved.setAttribute("position", new THREE.BufferAttribute(preservedPos, 3));
  preserved.computeVertexNormals();

  const generated = new THREE.BufferGeometry();
  generated.setAttribute("position", new THREE.BufferAttribute(generatedPos, 3));
  generated.computeVertexNormals();

  // Bias geometry along aggregate force direction and local normal to create organic ribs/cutouts.
  const avgForceDir = new THREE.Vector3();
  for (const dir of forceDirs) {
    avgForceDir.add(dir);
  }
  if (avgForceDir.lengthSq() <= 1e-12) {
    avgForceDir.set(0, 0, 1);
  } else {
    avgForceDir.normalize();
  }

  const gp = generated.getAttribute("position");
  const gn = generated.getAttribute("normal");
  if (gp && gn && gp.itemSize === 3 && gn.itemSize === 3) {
    for (let i = 0; i < gp.count; i += 1) {
      const vx = gp.getX(i);
      const vy = gp.getY(i);
      const vz = gp.getZ(i);
      const nx = gn.getX(i);
      const ny = gn.getY(i);
      const nz = gn.getZ(i);

      const normalBoost = 1 + 0.15 * Math.sin(i * 0.31);
      gp.setXYZ(
        i,
        vx + nx * params.thickness * normalBoost + avgForceDir.x * params.thickness * 0.55,
        vy + ny * params.thickness * normalBoost + avgForceDir.y * params.thickness * 0.55,
        vz + nz * params.thickness * normalBoost + avgForceDir.z * params.thickness * 0.55
      );
    }
    gp.needsUpdate = true;
  }

  const mergedGenerated = BufferGeometryUtils.mergeVertices(generated, 1e-5);
  mergedGenerated.computeVertexNormals();
  smoothIndexedGeometry(mergedGenerated, params.smoothIters, params.smoothAlpha);

  return {
    preserved,
    generated: mergedGenerated,
    keptFaceArea
  };
}

async function solveInWorker(request: SolveRequest): Promise<Outcome[]> {
  postMessageTyped({ type: "progress", stage: "parse", progress: 0.08, status: "running" });

  const sourceGeometry = await parseInputGeometry(request.model);
  const sourceNonIndexed = toNonIndexedGeometry(sourceGeometry);
  const totalFaces = faceCount(sourceNonIndexed);

  if (totalFaces < 8) {
    throw new Error("Model has too few faces for browser solve");
  }

  const preservedFaces = getPreservedFaceSet(request, totalFaces);
  if (preservedFaces.size === 0) {
    throw new Error("No preserved faces selected");
  }

  const posAttr = sourceNonIndexed.getAttribute("position");
  if (!(posAttr instanceof THREE.BufferAttribute) || posAttr.itemSize !== 3) {
    throw new Error("Input geometry has invalid position attribute");
  }

  const positions = posAttr.array as Float32Array;
  const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);

  const forces = normalizeForces(request);
  postMessageTyped({ type: "progress", stage: "voxelize", progress: 0.2, status: "running" });

  const influence = computeFaceInfluence(positions, totalFaces, preservedFaces, forces, bbox);
  postMessageTyped({ type: "progress", stage: "field-solve", progress: 0.38, status: "running" });

  const outcomes: Outcome[] = [];
  const unitScale = UNIT_TO_METERS[request.units];
  const density = request.material === "Aluminum 6061" ? 2700 : 2700;
  const eModulus = 69e9;
  const totalForceN = forces.reduce((sum, f) => sum + f.magnitudeN, 0);
  const charLenM = bbox.min.distanceTo(bbox.max) * unitScale;

  for (let idx = 0; idx < request.outcomeCount; idx += 1) {
    const params = variantParams(idx, request.outcomeCount);
    const synthProgress = 0.38 + ((idx + 1) / request.outcomeCount) * 0.44;
    postMessageTyped({ type: "progress", stage: "variant-synth", progress: clamp01(synthProgress), status: "running" });

    const { preserved, generated, keptFaceArea } = buildGeneratedGeometry(
      sourceNonIndexed,
      preservedFaces,
      influence,
      forces.map((f) => f.direction),
      params
    );

    const scene = new THREE.Scene();
    const preservedMesh = new THREE.Mesh(
      preserved,
      new THREE.MeshStandardMaterial({ color: 0x3bc282, metalness: 0.18, roughness: 0.55 })
    );
    preservedMesh.name = "preserved";

    const generatedMesh = new THREE.Mesh(
      generated,
      new THREE.MeshStandardMaterial({ color: 0x96a6bf, metalness: 0.24, roughness: 0.48 })
    );
    generatedMesh.name = "generated";

    scene.add(preservedMesh);
    scene.add(generatedMesh);

    postMessageTyped({ type: "progress", stage: "export", progress: clamp01(synthProgress + 0.06), status: "running" });

    const glb = await exportSceneToGlb(scene);

    const volumeDisplay = computeVolumeFromGeometry(preserved) + computeVolumeFromGeometry(generated);
    const volumeM3 = volumeDisplay * unitScale * unitScale * unitScale;
    const mass = volumeM3 * density;
    const effectiveAreaM2 = Math.max(keptFaceArea * unitScale * unitScale * 0.36, 1e-8);
    const stressProxy = (totalForceN / effectiveAreaM2) / 1e6;
    const displacementProxy = (totalForceN * Math.max(charLenM, 1e-6) / (eModulus * effectiveAreaM2)) * 1000;

    outcomes.push({
      id: `OUT-${String(idx + 1).padStart(2, "0")}`,
      optimizedModel: {
        format: "glb",
        dataBase64: arrayBufferToB64(glb)
      },
      metrics: {
        volume: Number(volumeDisplay.toFixed(6)),
        mass: Number(mass.toFixed(6)),
        stressProxy: Number(stressProxy.toFixed(6)),
        displacementProxy: Number(displacementProxy.toFixed(6))
      }
    });

    preserved.dispose();
    generated.dispose();
  }

  postMessageTyped({ type: "progress", stage: "complete", progress: 1, status: "succeeded" });
  return outcomes;
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  if (!event.data || event.data.type !== "solve") {
    return;
  }

  void solveInWorker(event.data.payload)
    .then((outcomes) => {
      postMessageTyped({ type: "result", outcomes });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Browser solve failed";
      postMessageTyped({ type: "error", error: message });
    });
};

export {};
