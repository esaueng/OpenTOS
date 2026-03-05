# Solver Assumptions (MVP)

## What the solver approximates

- The solver computes a directional load-influence scalar field over a voxelized design domain.
- Material is retained where force influence, preserved-interface proximity, and boundary-support terms are high.
- Variants are created by sweeping threshold and smoothing/rib-emphasis parameters.
- Browser mode uses a modular worker pipeline (`geometry` -> `voxel` -> `fields` -> `optimize` -> `mesh` -> `export`) with deterministic parameter sweeps.

## How this maps to Autodesk-like outcomes

- Preserved geometry is treated as immutable and exported unmodified as a separate node in each GLB.
- Generated geometry uses marching cubes + Taubin smoothing to avoid jagged voxel artifacts.
- Generated geometry uses marching-tetrahedra extraction + Taubin smoothing to avoid jagged voxel artifacts.
- Internal cutouts are carved from low-influence interior voxels while enforcing a minimum wall thickness band.

## What this does not do (yet)

- No full finite-element solve for stress/deflection.
- No manufacturing-constraint-aware topology optimization.
- No formal optimization objective function with convergence criteria.

## Proxy metrics

- `stressProxy`: load concentration estimate derived from total force and effective cross-sectional path area.
- `displacementProxy`: compliance-style estimate using characteristic length and material modulus.

Both proxies are deterministic and comparable across outcomes from the same study, but should not be used as certified engineering values.
