import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { UploadedModel } from "../types";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function findFirstMesh(object: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  object.traverse((child) => {
    if (found || !(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BufferGeometry)) {
      return;
    }
    found = child;
  });
  return found;
}

function toEditableGeometry(input: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = input.index ? input.toNonIndexed() : input.clone();
  geo.computeVertexNormals();
  geo.center();
  return geo;
}

export async function parseModelFile(file: File): Promise<UploadedModel> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["stl", "obj", "glb"].includes(ext)) {
    throw new Error("Only STL, OBJ, and GLB are supported");
  }

  const buffer = await file.arrayBuffer();
  const format = ext as UploadedModel["format"];
  const base64 = arrayBufferToBase64(buffer);

  if (format === "stl") {
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    return {
      fileName: file.name,
      format,
      dataBase64: base64,
      geometry: toEditableGeometry(geometry)
    };
  }

  if (format === "obj") {
    const text = new TextDecoder().decode(buffer);
    const loader = new OBJLoader();
    const object = loader.parse(text);
    const mesh = findFirstMesh(object);
    if (!mesh) {
      throw new Error("OBJ file did not contain mesh geometry");
    }

    return {
      fileName: file.name,
      format,
      dataBase64: base64,
      geometry: toEditableGeometry(mesh.geometry)
    };
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, "");
  const mesh = findFirstMesh(gltf.scene);
  if (!mesh) {
    throw new Error("GLB file did not contain mesh geometry");
  }

  return {
    fileName: file.name,
    format,
    dataBase64: base64,
    geometry: toEditableGeometry(mesh.geometry)
  };
}

export async function parseGlbFromBase64(base64: string): Promise<THREE.Object3D> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(bytes.buffer, "");
  return gltf.scene;
}
