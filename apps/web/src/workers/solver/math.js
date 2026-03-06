export function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function hash01(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}
export function index3D(grid, x, y, z) {
    return x + grid.nx * (y + grid.ny * z);
}
export function decodeIndex(grid, idx) {
    const z = Math.floor(idx / (grid.nx * grid.ny));
    const rem = idx - z * grid.nx * grid.ny;
    const y = Math.floor(rem / grid.nx);
    const x = rem - y * grid.nx;
    return { x, y, z };
}
export function voxelCenter(grid, x, y, z) {
    return [
        grid.origin[0] + (x + 0.5) * grid.step,
        grid.origin[1] + (y + 0.5) * grid.step,
        grid.origin[2] + (z + 0.5) * grid.step
    ];
}
export function volumeOfOccupancy(mask) {
    let count = 0;
    for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) {
            count += 1;
        }
    }
    return count;
}
export function normalizeVector(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len <= 1e-12) {
        return [0, 0, 1];
    }
    return [v[0] / len, v[1] / len, v[2] / len];
}
