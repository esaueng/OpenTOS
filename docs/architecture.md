# Architecture

## Web (`apps/web`)

- React + TypeScript + Vite.
- `@react-three/fiber` viewer with face brush painting for preserved/design labeling.
- Force placement by clicking mesh surfaces and editing direction/magnitude in-panel.
- Outcome grid supports side-by-side comparison with thumbnail previews and metric cards.

## API (`apps/api`)

- FastAPI service with async job execution via thread pool.
- SQLite metadata store (`studies`, `jobs`, `outcomes`) plus filesystem artifact persistence.
- Shared payload contract validated both by Pydantic and the shared JSON schema.

## Solver (`FusionApproxSolver`)

- Voxelization and influence-field synthesis.
- Directional load-bias weighting.
- Iterative carve + smooth + connectivity retention.
- Marching-cubes reconstruction and GLB scene export.

## Extensibility

- `SolverAdapter` protocol allows swapping in external topology solvers.
- Job manager and persistence are isolated from solver internals.
- Shared contracts package keeps frontend/backend payloads aligned.
