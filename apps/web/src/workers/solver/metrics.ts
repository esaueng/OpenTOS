import * as THREE from "three";

import { faceArea } from "./geometry";
import { MATERIAL_PROPERTIES } from "../../materials";
import type { ForceVec } from "./types";

const UNIT_TO_METERS: Record<"mm" | "in" | "m", number> = {
  mm: 0.001,
  in: 0.0254,
  m: 1
};

export function geometryVolume(geometry: THREE.BufferGeometry): number {
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

export function geometrySurfaceArea(geometry: THREE.BufferGeometry): number {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.getAttribute("position");
  if (!pos || pos.itemSize !== 3) {
    return 0;
  }
  const data = pos.array as Float32Array;
  let area = 0;
  const faces = Math.floor(data.length / 9);
  for (let faceIdx = 0; faceIdx < faces; faceIdx += 1) {
    area += faceArea(data, faceIdx);
  }
  return area;
}

export function computeOutcomeMetrics(args: {
  generatedGeometry: THREE.BufferGeometry;
  preservedGeometry: THREE.BufferGeometry;
  baselineVolume: number;
  units: "mm" | "in" | "m";
  material: string;
  forces: ForceVec[];
  characteristicLength: number;
}): {
  baselineVolume: number;
  volume: number;
  mass: number;
  massReductionPct: number;
  stressProxy: number;
  displacementProxy: number;
  safetyIndexProxy: number;
  complianceProxy: number;
} {
  const volume = geometryVolume(args.generatedGeometry) + geometryVolume(args.preservedGeometry);
  const unitScale = UNIT_TO_METERS[args.units] ?? 1;
  const volumeM3 = volume * unitScale * unitScale * unitScale;

  const materialProps = MATERIAL_PROPERTIES[args.material as keyof typeof MATERIAL_PROPERTIES] ?? MATERIAL_PROPERTIES["Aluminum 6061"];
  const density = materialProps.densityKgM3;
  const eModulus = materialProps.elasticModulusGPa * 1e9;

  const mass = volumeM3 * density;
  const totalForce = args.forces.reduce((sum, f) => sum + f.magnitudeN, 0);

  const area = geometrySurfaceArea(args.generatedGeometry);
  const effectiveArea = Math.max(area * unitScale * unitScale * 0.18, 1e-8);

  const stressProxy = (totalForce / effectiveArea) / 1e6;
  const displacementProxy =
    (totalForce * Math.max(args.characteristicLength * unitScale, 1e-6)) /
    (eModulus * effectiveArea) *
    1000;
  const baselineVolume = Math.max(args.baselineVolume, 1e-9);
  const massReductionPct = ((baselineVolume - volume) / baselineVolume) * 100;
  const yieldStrength = materialProps.yieldStrengthMPa;
  const safetyIndexProxy = yieldStrength / Math.max(stressProxy, 1e-6);
  const complianceProxy = displacementProxy * (totalForce / 1000 + 1);

  return {
    baselineVolume: Number(baselineVolume.toFixed(6)),
    volume: Number(volume.toFixed(6)),
    mass: Number(mass.toFixed(6)),
    massReductionPct: Number(massReductionPct.toFixed(6)),
    stressProxy: Number(stressProxy.toFixed(6)),
    displacementProxy: Number(displacementProxy.toFixed(6)),
    safetyIndexProxy: Number(safetyIndexProxy.toFixed(6)),
    complianceProxy: Number(complianceProxy.toFixed(6))
  };
}
