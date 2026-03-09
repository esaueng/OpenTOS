import { clamp01, index3D, normalizeVector, voxelCenter } from "./math";
function centroidFromMask(grid, mask) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (let z = 0; z < grid.nz; z += 1) {
        for (let y = 0; y < grid.ny; y += 1) {
            for (let x = 0; x < grid.nx; x += 1) {
                const idx = index3D(grid, x, y, z);
                if (!mask[idx]) {
                    continue;
                }
                const [cx, cy, cz] = voxelCenter(grid, x, y, z);
                sx += cx;
                sy += cy;
                sz += cz;
                count += 1;
            }
        }
    }
    if (count === 0) {
        return [grid.origin[0], grid.origin[1], grid.origin[2]];
    }
    return [sx / count, sy / count, sz / count];
}
function distanceToSegmentSquared(point, start, end) {
    const sx = end[0] - start[0];
    const sy = end[1] - start[1];
    const sz = end[2] - start[2];
    const px = point[0] - start[0];
    const py = point[1] - start[1];
    const pz = point[2] - start[2];
    const segLen2 = Math.max(1e-9, sx * sx + sy * sy + sz * sz);
    const t = clamp01((px * sx + py * sy + pz * sz) / segLen2);
    const qx = start[0] + sx * t;
    const qy = start[1] + sy * t;
    const qz = start[2] + sz * t;
    const dx = point[0] - qx;
    const dy = point[1] - qy;
    const dz = point[2] - qz;
    return dx * dx + dy * dy + dz * dz;
}
function normalizeField(values, mask) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < values.length; i += 1) {
        if (!mask[i]) {
            continue;
        }
        if (values[i] < min) {
            min = values[i];
        }
        if (values[i] > max) {
            max = values[i];
        }
    }
    const out = new Float32Array(values.length);
    const range = Math.max(max - min, 1e-9);
    for (let i = 0; i < values.length; i += 1) {
        if (!mask[i]) {
            continue;
        }
        out[i] = (values[i] - min) / range;
    }
    return out;
}
function diffuseField(field, domainMask, grid, iterations) {
    if (iterations <= 0) {
        return field;
    }
    const neighbors = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
    ];
    let src = field;
    let dst = new Float32Array(field.length);
    for (let it = 0; it < iterations; it += 1) {
        dst.fill(0);
        for (let z = 0; z < grid.nz; z += 1) {
            for (let y = 0; y < grid.ny; y += 1) {
                for (let x = 0; x < grid.nx; x += 1) {
                    const idx = index3D(grid, x, y, z);
                    if (!domainMask[idx]) {
                        continue;
                    }
                    let acc = src[idx] * 2.5;
                    let count = 2.5;
                    for (const [dx, dy, dz] of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const nz = z + dz;
                        if (nx < 0 || ny < 0 || nz < 0 || nx >= grid.nx || ny >= grid.ny || nz >= grid.nz) {
                            continue;
                        }
                        const nIdx = index3D(grid, nx, ny, nz);
                        if (!domainMask[nIdx]) {
                            continue;
                        }
                        acc += src[nIdx];
                        count += 1;
                    }
                    dst[idx] = acc / count;
                }
            }
        }
        const tmp = src;
        src = dst;
        dst = tmp;
    }
    return src;
}
export function normalizeForces(forces) {
    return forces.map((force) => ({
        ...force,
        direction: normalizeVector(force.direction)
    }));
}
export function computeBaseInfluenceFields(grid, domainMask, preserveMask, preservedDistance, forceDistance, forces, preservedTargets, connectivityIterations) {
    const directionalRaw = new Float32Array(grid.total);
    const boundaryRaw = new Float32Array(grid.total);
    const connectivityRaw = new Float32Array(grid.total);
    const medialRaw = new Float32Array(grid.total);
    const diagonal = grid.step * Math.hypot(grid.nx, grid.ny, grid.nz);
    const sigmaAxial = Math.max(diagonal * 0.32, grid.step * 3);
    const sigmaRadial = Math.max(diagonal * 0.07, grid.step * 1.7);
    const sigmaSegment = Math.max(diagonal * 0.055, grid.step * 1.5);
    const connScale = Math.max(diagonal * 0.28, grid.step * 2.4);
    const boundaryScale = Math.max(diagonal * 0.08, grid.step * 1.6);
    const balanceScale = Math.max(diagonal * 0.24, grid.step * 2);
    const medialScale = Math.max(diagonal * 0.09, grid.step * 1.4);
    const normalizedForces = normalizeForces(forces);
    const effectiveTargets = preservedTargets.length
        ? preservedTargets
        : [{ point: centroidFromMask(grid, preserveMask), weight: 1 }];
    for (let z = 0; z < grid.nz; z += 1) {
        for (let y = 0; y < grid.ny; y += 1) {
            for (let x = 0; x < grid.nx; x += 1) {
                const idx = index3D(grid, x, y, z);
                if (!domainMask[idx]) {
                    continue;
                }
                const c = voxelCenter(grid, x, y, z);
                let score = 0;
                let segmentScore = 0;
                let anchorNetworkScore = 0;
                for (const force of normalizedForces) {
                    const dx = c[0] - force.point[0];
                    const dy = c[1] - force.point[1];
                    const dz = c[2] - force.point[2];
                    const along = dx * force.direction[0] + dy * force.direction[1] + dz * force.direction[2];
                    const dist2 = dx * dx + dy * dy + dz * dz;
                    const perp2 = Math.max(0, dist2 - along * along);
                    const forward = Math.exp(-(along * along) / (2 * sigmaAxial * sigmaAxial));
                    const radial = Math.exp(-perp2 / (2 * sigmaRadial * sigmaRadial));
                    const directionalBias = along >= 0 ? 1 : 0.72;
                    let bestSegmentCorridor = 0;
                    let blendedCorridor = 0;
                    for (const target of effectiveTargets) {
                        const segmentDist2 = distanceToSegmentSquared(c, force.point, target.point);
                        const segmentCorridor = Math.exp(-segmentDist2 / (2 * sigmaSegment * sigmaSegment)) * Math.max(target.weight, 0.25);
                        bestSegmentCorridor = Math.max(bestSegmentCorridor, segmentCorridor);
                        blendedCorridor += segmentCorridor;
                    }
                    const targetCorridor = Math.max(bestSegmentCorridor, blendedCorridor * 0.35);
                    score += force.magnitudeN * Math.max(forward * radial * directionalBias, targetCorridor * 0.88);
                    segmentScore += targetCorridor * Math.sqrt(Math.max(force.magnitudeN, 1));
                }
                if (effectiveTargets.length > 1) {
                    for (let a = 0; a < effectiveTargets.length; a += 1) {
                        for (let b = a + 1; b < effectiveTargets.length; b += 1) {
                            const targetA = effectiveTargets[a];
                            const targetB = effectiveTargets[b];
                            const targetDist2 = distanceToSegmentSquared(c, targetA.point, targetB.point);
                            const targetCorridor = Math.exp(-targetDist2 / (2 * (sigmaSegment * 1.18) * (sigmaSegment * 1.18))) *
                                Math.sqrt(Math.max(targetA.weight * targetB.weight, 0.2));
                            anchorNetworkScore = Math.max(anchorNetworkScore, targetCorridor);
                        }
                    }
                }
                directionalRaw[idx] = score;
                const dPres = preservedDistance[idx] * grid.step;
                boundaryRaw[idx] = Math.exp(-dPres / boundaryScale);
                const dForce = forceDistance[idx] * grid.step;
                const pairDistance = dForce + dPres;
                const balance = Math.abs(dForce - dPres);
                const bridge = Math.exp(-pairDistance / connScale);
                const balancedPath = Math.exp(-balance / balanceScale);
                const connect = bridge * (0.65 + 0.35 * balancedPath);
                connectivityRaw[idx] = connect;
                medialRaw[idx] = Math.max(connect * Math.exp(-balance / medialScale), segmentScore, anchorNetworkScore * 0.95);
            }
        }
    }
    const directional = normalizeField(directionalRaw, domainMask);
    const boundary = normalizeField(boundaryRaw, domainMask);
    const connectivitySmoothed = diffuseField(normalizeField(connectivityRaw, domainMask), domainMask, grid, connectivityIterations);
    const connectivity = normalizeField(connectivitySmoothed, domainMask);
    const medial = normalizeField(diffuseField(normalizeField(medialRaw, domainMask), domainMask, grid, Math.max(2, Math.round(connectivityIterations * 0.5))), domainMask);
    return {
        directional,
        connectivity,
        boundary,
        medial
    };
}
export function combineInfluenceFields(base, domainMask, variant, targetSafetyFactor) {
    const out = new Float32Array(base.directional.length);
    const safetyBias = 1 + Math.max(0, targetSafetyFactor - 1) * 0.07;
    for (let i = 0; i < out.length; i += 1) {
        if (!domainMask[i]) {
            continue;
        }
        const directional = base.directional[i];
        const connectivity = base.connectivity[i];
        const boundary = base.boundary[i];
        const medial = base.medial[i];
        const composite = directional * variant.directionWeight +
            connectivity * variant.connectivityWeight +
            boundary * variant.boundaryWeight +
            medial * variant.medialWeight;
        const rib = Math.sqrt(Math.max(0, directional * connectivity));
        const bridgeFocus = Math.pow(Math.max(0, connectivity), 1.35) * (0.56 + directional * 0.18 + medial * 0.26);
        const branchFocus = Math.sqrt(Math.max(0, medial * directional));
        out[i] = clamp01((composite + rib * variant.ribBoost + bridgeFocus * 0.22 + branchFocus * 0.16) * safetyBias);
    }
    return out;
}
