# Architecture

## Web (`apps/web`)

- React + TypeScript + Vite.
- TypeScript is the only tracked source of truth for the web app; generated JS is not kept in `src/`.
- Browser-local solve is the canonical runtime; API execution is optional offload/reference.
- Workspace shell adapted from the OpenCAE design system (`src/theme/tokens.css`, `src/styles/app.css`):
  - `AppShell`: top bar / stepbar + viewport + context panel / outcome strip / status strip.
  - `StepBar`: Model → Preserve → Constraints → Loads → Study → Generate → Results, with completion state.
  - `ContextPanel` + `components/panels/*`: per-step controls, helper copy, and validation.
  - `lib/workflow.ts`: pure step-completion / run-readiness model (tested).
- `@react-three/fiber` viewer (`GenerativeDesignViewer` inside `ViewerShell`) with face brush painting for
  design/preserved/fixed/obstacle labeling, a viewer toolbar (original/generated/wireframe/fit), and a region legend.
- Force placement by clicking mesh surfaces and editing direction/magnitude in the Loads panel.
- Ranked outcomes compare side-by-side in the bottom `OutcomePanel` with thumbnail previews and metric cards.
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
- Fixed regions are modeled as preserved interface groups that are referenced by load-case `fixedRegions`.

## Solver (`FusionApproxSolver`)

- Constraint-map stage from design/preserved/obstacle/fixed regions.
- Voxelization and structural proxy field synthesis (connectivity + directional load influence).
- Iterative topology loop with smoothing, carve, and connectivity retention.
- Marching reconstruction and GLB scene export with `preserved` + `generated` nodes.
- Browser worker and API solver follow the same stage model and both reconstruct generated geometry from voxel occupancy rather than switching to a separate truss-mesh pipeline.

## Extensibility

- `SolverAdapter` protocol allows swapping in external topology solvers.
- Job manager and persistence are isolated from solver internals.
- Shared contracts package keeps frontend/backend payloads aligned.
