import * as THREE from "three";
export function toNonIndexedGeometryFromPositions(positions) {
    if (positions.length % 9 !== 0) {
        throw new Error("Solve geometry positions must be non-indexed triangles");
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
    geometry.computeVertexNormals();
    return geometry;
}
export function faceCountFromPositions(positions) {
    return Math.floor(positions.length / 9);
}
export function getPreservedData(request, totalFaces) {
    const allFaces = new Set();
    const groups = [];
    for (const region of request.preservedRegions) {
        const group = [];
        for (const idx of region.faceIndices) {
            if (idx >= 0 && idx < totalFaces) {
                allFaces.add(idx);
                group.push(idx);
            }
        }
        if (group.length > 0) {
            groups.push(group);
        }
    }
    return { allFaces, groups };
}
export function getFaceSet(faceIndices, totalFaces) {
    const faces = new Set();
    for (const idx of faceIndices) {
        if (idx >= 0 && idx < totalFaces) {
            faces.add(idx);
        }
    }
    return faces;
}
export function faceCenter(positions, faceIndex) {
    const base = faceIndex * 9;
    return [
        (positions[base] + positions[base + 3] + positions[base + 6]) / 3,
        (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3,
        (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3
    ];
}
export function faceArea(positions, faceIndex) {
    const i = faceIndex * 9;
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    return 0.5 * Math.hypot(crossX, crossY, crossZ);
}
export function gatherPositionsByFaces(positions, faceIndices) {
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
export function computeBoundingBox(positions) {
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < min[0])
            min[0] = x;
        if (y < min[1])
            min[1] = y;
        if (z < min[2])
            min[2] = z;
        if (x > max[0])
            max[0] = x;
        if (y > max[1])
            max[1] = y;
        if (z > max[2])
            max[2] = z;
    }
    const extent = [
        Math.max(max[0] - min[0], 1e-6),
        Math.max(max[1] - min[1], 1e-6),
        Math.max(max[2] - min[2], 1e-6)
    ];
    const diagonal = Math.hypot(extent[0], extent[1], extent[2]);
    return { min, max, extent, diagonal };
}
export function estimateSolverMemoryBytes(targetVoxels, outcomeCount) {
    const baseArrays = 11;
    const perVariantArrays = 2;
    const bytesPerFloat = 4;
    const bytesPerByte = 1;
    const base = targetVoxels * (baseArrays * bytesPerFloat + 4 * bytesPerByte);
    const variants = targetVoxels * outcomeCount * (perVariantArrays * bytesPerFloat + bytesPerByte);
    return Math.round(base + variants);
}
export function buildVoxelGrid(positions, targetVoxels, paddingRatio = 0.08) {
    const bbox = computeBoundingBox(positions);
    const pad = bbox.diagonal * paddingRatio;
    const min = [bbox.min[0] - pad, bbox.min[1] - pad, bbox.min[2] - pad];
    const max = [bbox.max[0] + pad, bbox.max[1] + pad, bbox.max[2] + pad];
    const extent = [
        Math.max(max[0] - min[0], 1e-6),
        Math.max(max[1] - min[1], 1e-6),
        Math.max(max[2] - min[2], 1e-6)
    ];
    const volume = extent[0] * extent[1] * extent[2];
    const nominalStep = Math.cbrt(volume / Math.max(targetVoxels, 8_000));
    const nx = Math.max(12, Math.round(extent[0] / nominalStep));
    const ny = Math.max(12, Math.round(extent[1] / nominalStep));
    const nz = Math.max(12, Math.round(extent[2] / nominalStep));
    const step = Math.max(extent[0] / nx, extent[1] / ny, extent[2] / nz);
    const adjustedNx = Math.max(12, Math.ceil(extent[0] / step));
    const adjustedNy = Math.max(12, Math.ceil(extent[1] / step));
    const adjustedNz = Math.max(12, Math.ceil(extent[2] / step));
    return {
        nx: adjustedNx,
        ny: adjustedNy,
        nz: adjustedNz,
        total: adjustedNx * adjustedNy * adjustedNz,
        origin: min,
        step
    };
}
export function triangleAtFace(positions, faceIdx) {
    const i = faceIdx * 9;
    const a = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    const b = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);
    return [a, b, c];
}
