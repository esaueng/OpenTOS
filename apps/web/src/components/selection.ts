import * as THREE from "three";

export interface SurfaceTopology {
  faceCenters: THREE.Vector3[];
  faceNormals: THREE.Vector3[];
  adjacency: number[][];
  edgeFaces: Map<string, number[]>;
  edgeVertices: Map<string, [string, string]>;
  vertexPositions: Map<string, THREE.Vector3>;
}

interface BoundaryLoop {
  edgeKeys: string[];
  points2d: [number, number][];
  areaAbs: number;
}

function quantizedVertexKey(x: number, y: number, z: number): string {
  const q = 1e5;
  return `${Math.round(x * q)}:${Math.round(y * q)}:${Math.round(z * q)}`;
}

function edgeKeyFor(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function polygonArea(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum * 0.5;
}

function pointOnSegment(point: [number, number], start: [number, number], end: [number, number], epsilon: number): boolean {
  const sx = end[0] - start[0];
  const sy = end[1] - start[1];
  const segLen2 = sx * sx + sy * sy;
  if (segLen2 <= 1e-12) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]) <= epsilon;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * sx + (point[1] - start[1]) * sy) / segLen2)
  );
  const qx = start[0] + sx * t;
  const qy = start[1] + sy * t;
  return Math.hypot(point[0] - qx, point[1] - qy) <= epsilon;
}

function pointOnPolygonEdge(point: [number, number], polygon: [number, number][], epsilon: number): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    if (pointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length], epsilon)) {
      return true;
    }
  }
  return false;
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let windingNumber = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, y0] = polygon[i];
    const [x1, y1] = polygon[(i + 1) % polygon.length];
    const cross = (x1 - x0) * (point[1] - y0) - (point[0] - x0) * (y1 - y0);
    if (y0 <= point[1]) {
      if (y1 > point[1] && cross > 0) {
        windingNumber += 1;
      }
    } else if (y1 <= point[1] && cross < 0) {
      windingNumber -= 1;
    }
  }
  return windingNumber !== 0;
}

function averageSurfaceNormal(topology: SurfaceTopology, faces: number[]): THREE.Vector3 {
  const normal = new THREE.Vector3();
  for (const faceIndex of faces) {
    normal.add(topology.faceNormals[faceIndex]);
  }
  if (normal.lengthSq() <= 1e-12) {
    return new THREE.Vector3(0, 0, 1);
  }
  return normal.normalize();
}

function isMostlyPlanarSurface(topology: SurfaceTopology, faces: number[]): { normal: THREE.Vector3; mostlyPlanar: boolean } {
  const normal = averageSurfaceNormal(topology, faces);
  const planarThreshold = Math.cos(THREE.MathUtils.degToRad(18));
  const planarFaces = faces.filter((faceIndex) => Math.abs(topology.faceNormals[faceIndex].dot(normal)) >= planarThreshold);
  return {
    normal,
    mostlyPlanar: planarFaces.length >= Math.max(6, Math.floor(faces.length * 0.85))
  };
}

function buildProjectionBasis(normal: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const reference = Math.abs(normal.z) < 0.82 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(reference, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

function computeBoundaryLoops(topology: SurfaceTopology, surfaceFaces: number[]): BoundaryLoop[] {
  const surfaceSet = new Set(surfaceFaces);
  const boundaryEdgeKeys: string[] = [];
  const vertexAdjacency = new Map<string, Set<string>>();

  for (const [edgeKey, faces] of topology.edgeFaces.entries()) {
    let inSurface = 0;
    for (const faceIndex of faces) {
      if (surfaceSet.has(faceIndex)) {
        inSurface += 1;
      }
    }
    if (inSurface !== 1) {
      continue;
    }
    boundaryEdgeKeys.push(edgeKey);
    const edgeVertices = topology.edgeVertices.get(edgeKey);
    if (!edgeVertices) {
      continue;
    }
    const [a, b] = edgeVertices;
    if (!vertexAdjacency.has(a)) {
      vertexAdjacency.set(a, new Set());
    }
    if (!vertexAdjacency.has(b)) {
      vertexAdjacency.set(b, new Set());
    }
    vertexAdjacency.get(a)!.add(b);
    vertexAdjacency.get(b)!.add(a);
  }

  if (boundaryEdgeKeys.length === 0) {
    return [];
  }

  const normal = averageSurfaceNormal(topology, surfaceFaces);
  const planeOrigin = topology.faceCenters[surfaceFaces[0]] ?? new THREE.Vector3();
  const { u, v } = buildProjectionBasis(normal);
  const projectPoint = (point: THREE.Vector3): [number, number] => {
    const delta = point.clone().sub(planeOrigin);
    return [delta.dot(u), delta.dot(v)];
  };

  const unusedEdges = new Set(boundaryEdgeKeys);
  const loops: BoundaryLoop[] = [];

  while (unusedEdges.size > 0) {
    const startEdgeKey = unusedEdges.values().next().value as string;
    const startEdge = topology.edgeVertices.get(startEdgeKey);
    if (!startEdge) {
      unusedEdges.delete(startEdgeKey);
      continue;
    }

    let [previous, current] = startEdge;
    const vertexKeys = [previous, current];
    const edgeKeys = [startEdgeKey];
    unusedEdges.delete(startEdgeKey);

    while (current !== vertexKeys[0]) {
      const nextOptions = Array.from(vertexAdjacency.get(current) ?? []).filter(
        (candidate) => candidate !== previous && unusedEdges.has(edgeKeyFor(current, candidate))
      );
      if (nextOptions.length === 0) {
        const closingKey = edgeKeyFor(current, vertexKeys[0]);
        if (!unusedEdges.has(closingKey)) {
          break;
        }
        nextOptions.push(vertexKeys[0]);
      }

      const next = nextOptions[0];
      const nextEdgeKey = edgeKeyFor(current, next);
      edgeKeys.push(nextEdgeKey);
      vertexKeys.push(next);
      unusedEdges.delete(nextEdgeKey);
      previous = current;
      current = next;
    }

    if (vertexKeys.length < 4 || vertexKeys[vertexKeys.length - 1] !== vertexKeys[0]) {
      continue;
    }

    const uniqueVertices = vertexKeys.slice(0, -1);
    const points2d = uniqueVertices
      .map((vertexKey) => topology.vertexPositions.get(vertexKey))
      .filter((value): value is THREE.Vector3 => Boolean(value))
      .map(projectPoint);

    if (points2d.length < 3) {
      continue;
    }

    loops.push({
      edgeKeys,
      points2d,
      areaAbs: Math.abs(polygonArea(points2d))
    });
  }

  return loops;
}

export function buildSurfaceTopology(geometry: THREE.BufferGeometry): SurfaceTopology {
  const position = geometry.getAttribute("position");
  const faceCount = position.count / 3;
  const faceCenters: THREE.Vector3[] = [];
  const faceNormals = Array.from({ length: faceCount }, () => new THREE.Vector3(0, 0, 1));
  const adjacency = Array.from({ length: faceCount }, () => [] as number[]);
  const edgeFaces = new Map<string, number[]>();
  const edgeVertices = new Map<string, [string, string]>();
  const vertexPositions = new Map<string, THREE.Vector3>();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const i0 = faceIndex * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);

    faceCenters.push(new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3));

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const normal = new THREE.Vector3().crossVectors(ab, ac);
    faceNormals[faceIndex] = normal.lengthSq() > 1e-12 ? normal.normalize() : new THREE.Vector3(0, 0, 1);

    const keys = [
      quantizedVertexKey(a.x, a.y, a.z),
      quantizedVertexKey(b.x, b.y, b.z),
      quantizedVertexKey(c.x, c.y, c.z)
    ] as const;
    const points = [a.clone(), b.clone(), c.clone()] as const;

    for (let i = 0; i < keys.length; i += 1) {
      if (!vertexPositions.has(keys[i])) {
        vertexPositions.set(keys[i], points[i]);
      }
    }

    const edges: [string, string][] = [
      [keys[0], keys[1]],
      [keys[1], keys[2]],
      [keys[2], keys[0]]
    ];

    for (const [u, v] of edges) {
      const edgeKey = edgeKeyFor(u, v);
      if (!edgeVertices.has(edgeKey)) {
        edgeVertices.set(edgeKey, u < v ? [u, v] : [v, u]);
      }
      const faces = edgeFaces.get(edgeKey);
      if (faces) {
        faces.push(faceIndex);
      } else {
        edgeFaces.set(edgeKey, [faceIndex]);
      }
    }
  }

  edgeFaces.forEach((faces) => {
    if (faces.length < 2) {
      return;
    }
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        const left = faces[i];
        const right = faces[j];
        adjacency[left].push(right);
        adjacency[right].push(left);
      }
    }
  });

  return {
    faceCenters,
    faceNormals,
    adjacency,
    edgeFaces,
    edgeVertices,
    vertexPositions
  };
}

export function selectContiguousSurface(
  startFaceIndex: number,
  topology: SurfaceTopology,
  maxNormalAngleDeg = 34
): number[] {
  if (startFaceIndex < 0 || startFaceIndex >= topology.faceNormals.length) {
    return [];
  }

  const visited = new Uint8Array(topology.faceNormals.length);
  const queue: number[] = [startFaceIndex];
  const selected: number[] = [];
  const cosineThreshold = Math.cos(THREE.MathUtils.degToRad(maxNormalAngleDeg));

  visited[startFaceIndex] = 1;

  while (queue.length > 0) {
    const current = queue.pop()!;
    selected.push(current);

    const currentNormal = topology.faceNormals[current];
    for (const next of topology.adjacency[current]) {
      if (visited[next]) {
        continue;
      }
      if (currentNormal.dot(topology.faceNormals[next]) >= cosineThreshold) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }

  return selected;
}

export function selectConnectedLabeledFaces(
  startFaceIndex: number,
  topology: SurfaceTopology,
  faceLabels: Array<string | undefined>,
  targetLabel: string
): number[] {
  if (
    startFaceIndex < 0 ||
    startFaceIndex >= topology.faceNormals.length ||
    faceLabels[startFaceIndex] !== targetLabel
  ) {
    return [];
  }

  const visited = new Uint8Array(topology.faceNormals.length);
  const queue: number[] = [startFaceIndex];
  const selected: number[] = [];
  visited[startFaceIndex] = 1;

  while (queue.length > 0) {
    const current = queue.pop()!;
    selected.push(current);

    for (const next of topology.adjacency[current]) {
      if (visited[next] || faceLabels[next] !== targetLabel) {
        continue;
      }
      visited[next] = 1;
      queue.push(next);
    }
  }

  return selected;
}

function redirectHoleSurfaceSelection(
  startFaceIndex: number,
  baseSurface: number[],
  topology: SurfaceTopology,
  ray: THREE.Ray
): number[] | null {
  const { normal: surfaceNormal, mostlyPlanar } = isMostlyPlanarSurface(topology, baseSurface);
  if (!mostlyPlanar) {
    return null;
  }

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(surfaceNormal, topology.faceCenters[startFaceIndex]);
  const planeHit = ray.intersectPlane(plane, new THREE.Vector3());
  if (!planeHit) {
    return null;
  }

  const loops = computeBoundaryLoops(topology, baseSurface);
  if (loops.length < 2) {
    return null;
  }

  const largestArea = Math.max(...loops.map((loop) => loop.areaAbs));
  const { u, v } = buildProjectionBasis(surfaceNormal);
  const planeOrigin = topology.faceCenters[startFaceIndex];
  const delta = planeHit.clone().sub(planeOrigin);
  const projectedPoint: [number, number] = [delta.dot(u), delta.dot(v)];

  const holeLoop = loops
    .filter(
      (loop) =>
        loop.areaAbs < largestArea * 0.98 &&
        (pointOnPolygonEdge(projectedPoint, loop.points2d, 0.012) || pointInPolygon(projectedPoint, loop.points2d))
    )
    .sort((left, right) => left.areaAbs - right.areaAbs)[0];

  if (!holeLoop) {
    return null;
  }

  const baseSurfaceSet = new Set(baseSurface);
  const sidewallSeeds = new Set<number>();

  for (const edgeKey of holeLoop.edgeKeys) {
    const faces = topology.edgeFaces.get(edgeKey) ?? [];
    for (const faceIndex of faces) {
      if (baseSurfaceSet.has(faceIndex)) {
        continue;
      }
      const normalDot = Math.abs(topology.faceNormals[faceIndex].dot(surfaceNormal));
      if (normalDot > 0.72) {
        continue;
      }
      sidewallSeeds.add(faceIndex);
    }
  }

  if (sidewallSeeds.size === 0) {
    return null;
  }

  const queue = Array.from(sidewallSeeds);
  const visited = new Uint8Array(topology.faceNormals.length);
  const redirectedSurface: number[] = [];

  for (const faceIndex of queue) {
    visited[faceIndex] = 1;
  }

  while (queue.length > 0) {
    const current = queue.pop()!;
    redirectedSurface.push(current);

    for (const next of topology.adjacency[current]) {
      if (visited[next] || baseSurfaceSet.has(next)) {
        continue;
      }
      if (Math.abs(topology.faceNormals[next].dot(surfaceNormal)) > 0.72) {
        continue;
      }
      visited[next] = 1;
      queue.push(next);
    }
  }

  return redirectedSurface.length > 0 ? redirectedSurface : null;
}

export function resolvePreservedSurfaceSelectionFromCandidates(
  candidateFaceIndices: number[],
  topology: SurfaceTopology,
  ray: THREE.Ray
): number[] {
  const orderedCandidates = Array.from(new Set(candidateFaceIndices)).filter(
    (faceIndex) => faceIndex >= 0 && faceIndex < topology.faceNormals.length
  );
  if (orderedCandidates.length === 0) {
    return [];
  }

  const primaryBaseSurface = selectContiguousSurface(orderedCandidates[0], topology);
  if (primaryBaseSurface.length === 0) {
    return primaryBaseSurface;
  }

  const primaryShape = isMostlyPlanarSurface(topology, primaryBaseSurface);
  if (!primaryShape.mostlyPlanar) {
    return primaryBaseSurface;
  }

  for (const candidateFace of orderedCandidates) {
    const baseSurface = selectContiguousSurface(candidateFace, topology);
    if (baseSurface.length === 0) {
      continue;
    }
    const redirectedSurface = redirectHoleSurfaceSelection(candidateFace, baseSurface, topology, ray);
    if (redirectedSurface && redirectedSurface.length > 0) {
      return redirectedSurface;
    }
  }

  return primaryBaseSurface;
}

export function resolvePreservedSurfaceSelection(
  startFaceIndex: number,
  topology: SurfaceTopology,
  ray: THREE.Ray
): number[] {
  return resolvePreservedSurfaceSelectionFromCandidates([startFaceIndex], topology, ray);
}
