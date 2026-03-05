# Solver Spec V2

## Scope

This spec defines the parity contract between browser worker solve and API solve for OpenTOS v2.

## Stage Semantics

1. `parse`: decode model + validate schema.
2. `constraint-map`: map design/preserved/obstacle/fixed regions.
3. `voxelize`: voxel domain generation and mask construction.
4. `fem-solve`: compute structural proxy fields (directional + connectivity + boundary support).
5. `topology-opt`: density update loop and carve/thickness/connectivity passes.
6. `reconstruct`: iso-surface extraction and smoothing.
7. `rank-export`: uniqueness gates, metrics, and GLB export.
8. `complete`: finalization.

## Default Profiles

- `high-fidelity`: target ~3.2M voxels, high smoothing/iteration budget.
- `balanced`: target ~1.5M voxels.
- `fast-preview`: target ~0.55M voxels.

## Field and Optimization Model

- Directional force kernels bias retention along load vectors.
- Connectivity field rewards voxels linking force seeds to preserved/fixed constraints.
- Boundary support field preserves stable shell zones.
- Combined influence field feeds iterative density updates.
- Minimum thickness and connected-component retention are enforced each cycle.

## Variant Policy

- Variants sweep target volume fraction, anisotropy, smoothing, and rib emphasis.
- Near-duplicates are rejected using occupancy overlap and shape signatures.
- If uniqueness budget cannot be met, solver returns warnings and best-effort outcomes.

## Output Contract

- Each outcome exports GLB with two required nodes:
  - `preserved` (exact preserved triangles)
  - `generated` (optimized body)
- Metrics are proxy values:
  - `baselineVolume`
  - `volume`
  - `mass`
  - `massReductionPct`
  - `stressProxy`
  - `displacementProxy`
  - `safetyIndexProxy`
  - `complianceProxy`
