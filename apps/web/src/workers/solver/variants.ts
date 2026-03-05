import { hash01 } from "./math";
import type { VariantParams } from "./types";

export interface VariantSignature {
  volumeRatio: number;
  radialHistogram: number[];
}

export function variantParams(index: number, count: number, minThickness: number, jitterSeed = 0): VariantParams {
  const t = count <= 1 ? 0 : index / (count - 1);
  const j = hash01(index * 13.17 + jitterSeed * 3.11);
  const k = hash01(index * 7.63 + jitterSeed * 9.41);

  return {
    targetVolumeFraction: 0.11 + (1 - t) * 0.17 + (j - 0.5) * 0.03,
    directionWeight: 0.5 + (1 - t) * 0.22 + (k - 0.5) * 0.05,
    connectivityWeight: 0.42 + t * 0.18 + (j - 0.5) * 0.04,
    boundaryWeight: 0.08 + t * 0.1,
    smoothFactor: 0.2 + t * 0.14,
    minThickness: Math.max(1, minThickness + Math.round((k - 0.5) * 1.5)),
    ribBoost: 0.22 + (1 - t) * 0.26 + (j - 0.5) * 0.06
  };
}

function iouWithStride(a: Uint8Array, b: Uint8Array, domainMask: Uint8Array, stride: number): number {
  let inter = 0;
  let union = 0;

  for (let i = 0; i < a.length; i += stride) {
    if (!domainMask[i]) {
      continue;
    }
    const av = a[i] ? 1 : 0;
    const bv = b[i] ? 1 : 0;
    if (av || bv) {
      union += 1;
      if (av && bv) {
        inter += 1;
      }
    }
  }

  return union > 0 ? inter / union : 1;
}

export function computeSignature(occupancy: Uint8Array, domainMask: Uint8Array): VariantSignature {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;

  const bins = 10;
  const histogram = Array.from({ length: bins }, () => 0);

  for (let i = 0; i < occupancy.length; i += 1) {
    if (!domainMask[i] || !occupancy[i]) {
      continue;
    }
    count += 1;
    sx += i;
    sy += i % 97;
    sz += i % 193;
  }

  const cx = count > 0 ? sx / count : 0;
  const cy = count > 0 ? sy / count : 0;
  const cz = count > 0 ? sz / count : 0;

  for (let i = 0; i < occupancy.length; i += 1) {
    if (!domainMask[i] || !occupancy[i]) {
      continue;
    }

    const dx = i - cx;
    const dy = (i % 97) - cy;
    const dz = (i % 193) - cz;
    const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const bucket = Math.min(bins - 1, Math.floor((radius / Math.max(1, occupancy.length * 0.12)) * bins));
    histogram[bucket] += 1;
  }

  const inv = count > 0 ? 1 / count : 1;
  for (let b = 0; b < bins; b += 1) {
    histogram[b] *= inv;
  }

  return {
    volumeRatio: count / Math.max(1, occupancy.length),
    radialHistogram: histogram
  };
}

export function signatureDistance(a: VariantSignature, b: VariantSignature): number {
  let score = Math.abs(a.volumeRatio - b.volumeRatio) * 3.5;
  const bins = Math.min(a.radialHistogram.length, b.radialHistogram.length);
  for (let i = 0; i < bins; i += 1) {
    score += Math.abs(a.radialHistogram[i] - b.radialHistogram[i]);
  }
  return score;
}

export function isUniqueVariant(
  candidateOccupancy: Uint8Array,
  candidateSignature: VariantSignature,
  existing: { occupancy: Uint8Array; signature: VariantSignature }[],
  domainMask: Uint8Array
): boolean {
  for (const other of existing) {
    const iou = iouWithStride(candidateOccupancy, other.occupancy, domainMask, 2);
    const sigDist = signatureDistance(candidateSignature, other.signature);
    const volumeRatio =
      Math.min(candidateSignature.volumeRatio, other.signature.volumeRatio) /
      Math.max(candidateSignature.volumeRatio, other.signature.volumeRatio, 1e-6);

    if (iou > 0.93 && volumeRatio > 0.97 && sigDist < 0.075) {
      return false;
    }
  }
  return true;
}
