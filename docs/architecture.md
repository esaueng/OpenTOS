# Architecture

## Web (`apps/web`)

- React + TypeScript + Vite.
- `@react-three/fiber` viewer with face brush painting for design/preserved/obstacle labeling.
- Force placement by clicking mesh surfaces and editing direction/magnitude in-panel.
- Outcome grid supports side-by-side comparison with thumbnail previews and metric cards.
- Browser worker solver stack in `apps/web/src/workers/solver`:
  - `voxel.ts`: domain voxelization + flood fill + seed distances
  - `fields.ts`: directional/connectivity/boundary influence fields
  - `optimize.ts`: density evolution and thickness enforcement
  - `mesh.ts`: marching-tetra extraction + Taubin smoothing
  - `variants.ts`: multi-outcome parameter sweep + uniqueness gates

## API (`apps/api`)

- FastAPI service with study-centric v2 endpoints:
  - `POST /api/studies`
  - `GET /api/studies/{studyId}`
  - `POST /api/studies/{studyId}/run`
  - `GET /api/jobs/{jobId}`
  - `GET /api/studies/{studyId}/outcomes`
  - `GET /api/materials`
  - `GET /api/benchmarks/{benchmarkId}`
- Async job execution via thread pool.
- SQLite metadata store (`studies_v2`, `study_constraints_v2`, `study_loadcases_v2`, `jobs_v2`, `outcomes_v2`, `benchmarks_v2`) plus filesystem artifact persistence.
- Shared payload contract validated by Pydantic and shared JSON schema (`packages/contracts/schema`).

## Solver (`FusionApproxSolver`)

- Constraint-map stage from design/preserved/obstacle/fixed regions.
- Voxelization and structural proxy field synthesis (connectivity + directional load influence).
- Iterative topology loop with smoothing, carve, and connectivity retention.
- Marching reconstruction and GLB scene export with `preserved` + `generated` nodes.

## Extensibility

- `SolverAdapter` protocol allows swapping in external topology solvers.
- Job manager and persistence are isolated from solver internals.
- Shared contracts package keeps frontend/backend payloads aligned.
