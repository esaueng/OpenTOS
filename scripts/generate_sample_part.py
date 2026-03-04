#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import struct
from pathlib import Path


def normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = v
    length = math.sqrt(x * x + y * y + z * z)
    if length <= 1e-12:
        return (0.0, 0.0, 1.0)
    return (x / length, y / length, z / length)


def add_hollow_cylinder(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int]],
    *,
    cx: float,
    outer_r: float,
    inner_r: float,
    thickness: float,
    segments: int,
) -> None:
    base = len(vertices)
    z_top = thickness * 0.5
    z_bottom = -thickness * 0.5

    for i in range(segments):
        angle = 2.0 * math.pi * i / segments
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        vertices.append((cx + outer_r * cos_a, outer_r * sin_a, z_top))
        vertices.append((cx + outer_r * cos_a, outer_r * sin_a, z_bottom))
        vertices.append((cx + inner_r * cos_a, inner_r * sin_a, z_top))
        vertices.append((cx + inner_r * cos_a, inner_r * sin_a, z_bottom))

    for i in range(segments):
        n = (i + 1) % segments
        o0 = base + i * 4
        o1 = base + n * 4

        # Outer wall
        faces.append((o0, o1, o0 + 1))
        faces.append((o1, o1 + 1, o0 + 1))

        # Inner wall (reverse winding)
        faces.append((o0 + 2, o0 + 3, o1 + 2))
        faces.append((o1 + 2, o0 + 3, o1 + 3))

        # Top annulus
        faces.append((o0, o0 + 2, o1))
        faces.append((o1, o0 + 2, o1 + 2))

        # Bottom annulus
        faces.append((o0 + 1, o1 + 1, o0 + 3))
        faces.append((o1 + 1, o1 + 3, o0 + 3))


def add_tapered_web(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int]],
    *,
    x0: float,
    x1: float,
    width0: float,
    width1: float,
    thickness: float,
    span_steps: int,
) -> None:
    base = len(vertices)

    # For each span step: top-left, top-right, bottom-left, bottom-right
    for i in range(span_steps + 1):
        t = i / span_steps
        x = x0 + (x1 - x0) * t
        bulge = 1.0 + 0.18 * math.sin(t * math.pi)
        half_w = (width0 + (width1 - width0) * t) * bulge
        z_top = thickness * 0.5
        z_bottom = -thickness * 0.5

        vertices.append((x, half_w, z_top))
        vertices.append((x, -half_w, z_top))
        vertices.append((x, half_w, z_bottom))
        vertices.append((x, -half_w, z_bottom))

    for i in range(span_steps):
        a = base + i * 4
        b = base + (i + 1) * 4

        # Top surface
        faces.append((a, b, a + 1))
        faces.append((b, b + 1, a + 1))

        # Bottom surface
        faces.append((a + 2, a + 3, b + 2))
        faces.append((b + 2, a + 3, b + 3))

        # Side +Y
        faces.append((a, a + 2, b))
        faces.append((b, a + 2, b + 2))

        # Side -Y
        faces.append((a + 1, b + 1, a + 3))
        faces.append((b + 1, b + 3, a + 3))

    # Start cap
    s = base
    faces.append((s, s + 1, s + 2))
    faces.append((s + 1, s + 3, s + 2))

    # End cap
    e = base + span_steps * 4
    faces.append((e, e + 2, e + 1))
    faces.append((e + 1, e + 2, e + 3))


def compute_vertex_normals(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int]],
) -> list[tuple[float, float, float]]:
    accum = [[0.0, 0.0, 0.0] for _ in vertices]
    for i0, i1, i2 in faces:
        v0 = vertices[i0]
        v1 = vertices[i1]
        v2 = vertices[i2]

        ux, uy, uz = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
        vx, vy, vz = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx

        accum[i0][0] += nx
        accum[i0][1] += ny
        accum[i0][2] += nz
        accum[i1][0] += nx
        accum[i1][1] += ny
        accum[i1][2] += nz
        accum[i2][0] += nx
        accum[i2][1] += ny
        accum[i2][2] += nz

    return [normalize((n[0], n[1], n[2])) for n in accum]


def write_obj(path: Path, vertices: list[tuple[float, float, float]], faces: list[tuple[int, int, int]]) -> None:
    lines: list[str] = ["# OpenTOS connecting rod sample"]
    for x, y, z in vertices:
        lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
    for i0, i1, i2 in faces:
        lines.append(f"f {i0 + 1} {i1 + 1} {i2 + 1}")
    path.write_text("\n".join(lines) + "\n")


def write_stl(path: Path, vertices: list[tuple[float, float, float]], faces: list[tuple[int, int, int]]) -> None:
    out = ["solid opentos_connecting_rod"]
    for i0, i1, i2 in faces:
        v0 = vertices[i0]
        v1 = vertices[i1]
        v2 = vertices[i2]
        ux, uy, uz = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
        vx, vy, vz = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
        normal = normalize((uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx))
        out.append(f"  facet normal {normal[0]:.6f} {normal[1]:.6f} {normal[2]:.6f}")
        out.append("    outer loop")
        out.append(f"      vertex {v0[0]:.6f} {v0[1]:.6f} {v0[2]:.6f}")
        out.append(f"      vertex {v1[0]:.6f} {v1[1]:.6f} {v1[2]:.6f}")
        out.append(f"      vertex {v2[0]:.6f} {v2[1]:.6f} {v2[2]:.6f}")
        out.append("    endloop")
        out.append("  endfacet")
    out.append("endsolid opentos_connecting_rod")
    path.write_text("\n".join(out) + "\n")


def pack_f32(values: list[float]) -> bytes:
    return struct.pack("<" + "f" * len(values), *values)


def pack_u32(values: list[int]) -> bytes:
    return struct.pack("<" + "I" * len(values), *values)


def pad4(data: bytes, pad: bytes = b"\x00") -> bytes:
    extra = (-len(data)) % 4
    if extra == 0:
        return data
    return data + (pad * extra)


def write_glb(
    path: Path,
    vertices: list[tuple[float, float, float]],
    normals: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int]],
) -> None:
    indices: list[int] = []
    for i0, i1, i2 in faces:
        indices.extend([i0, i1, i2])

    pos_flat: list[float] = []
    nrm_flat: list[float] = []
    for i in range(len(vertices)):
        pos_flat.extend(vertices[i])
        nrm_flat.extend(normals[i])

    index_bytes = pad4(pack_u32(indices))
    pos_bytes = pad4(pack_f32(pos_flat))
    nrm_bytes = pad4(pack_f32(nrm_flat))

    i_offset = 0
    p_offset = len(index_bytes)
    n_offset = p_offset + len(pos_bytes)

    blob = index_bytes + pos_bytes + nrm_bytes

    xs = [v[0] for v in vertices]
    ys = [v[1] for v in vertices]
    zs = [v[2] for v in vertices]

    gltf = {
        "asset": {"version": "2.0", "generator": "OpenTOS sample generator"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "connecting_rod_sample"}],
        "meshes": [
            {
                "name": "connecting_rod_sample_mesh",
                "primitives": [
                    {
                        "attributes": {"POSITION": 1, "NORMAL": 2},
                        "indices": 0,
                        "mode": 4
                    }
                ]
            }
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": i_offset,
                "byteLength": len(index_bytes),
                "target": 34963
            },
            {
                "buffer": 0,
                "byteOffset": p_offset,
                "byteLength": len(pos_bytes),
                "target": 34962
            },
            {
                "buffer": 0,
                "byteOffset": n_offset,
                "byteLength": len(nrm_bytes),
                "target": 34962
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5125,
                "count": len(indices),
                "type": "SCALAR",
                "min": [0],
                "max": [len(vertices) - 1]
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(vertices),
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)]
            },
            {
                "bufferView": 2,
                "componentType": 5126,
                "count": len(vertices),
                "type": "VEC3"
            }
        ],
        "materials": [
            {
                "name": "SampleMaterial",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.55, 0.62, 0.72, 1.0],
                    "metallicFactor": 0.1,
                    "roughnessFactor": 0.62
                }
            }
        ]
    }

    json_bytes = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), pad=b" ")

    total_length = 12 + 8 + len(json_bytes) + 8 + len(blob)
    header = struct.pack("<III", 0x46546C67, 2, total_length)
    json_chunk_header = struct.pack("<II", len(json_bytes), 0x4E4F534A)
    bin_chunk_header = struct.pack("<II", len(blob), 0x004E4942)

    glb = header + json_chunk_header + json_bytes + bin_chunk_header + blob
    path.write_bytes(glb)


def build_sample() -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    thickness = 0.20
    center_delta = 0.95

    add_hollow_cylinder(
        vertices,
        faces,
        cx=-center_delta,
        outer_r=0.46,
        inner_r=0.19,
        thickness=thickness,
        segments=56,
    )
    add_hollow_cylinder(
        vertices,
        faces,
        cx=center_delta,
        outer_r=0.32,
        inner_r=0.12,
        thickness=thickness,
        segments=48,
    )
    add_tapered_web(
        vertices,
        faces,
        x0=-0.62,
        x1=0.68,
        width0=0.14,
        width1=0.11,
        thickness=thickness,
        span_steps=26,
    )

    return vertices, faces


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "assets" / "samples"
    out_dir.mkdir(parents=True, exist_ok=True)

    vertices, faces = build_sample()
    normals = compute_vertex_normals(vertices, faces)

    write_obj(out_dir / "connecting_rod_sample.obj", vertices, faces)
    write_stl(out_dir / "connecting_rod_sample.stl", vertices, faces)
    write_glb(out_dir / "connecting_rod_sample.glb", vertices, normals, faces)

    manifest = {
        "name": "connecting_rod_sample",
        "vertexCount": len(vertices),
        "faceCount": len(faces),
        "units": "arbitrary-model-units",
        "description": "Parametric connecting-rod style mesh used as a study starter for OpenTOS"
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
