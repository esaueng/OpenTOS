# Extension Guide

## Replacing the MVP solver with real FEA/topology optimization

1. Implement a new class that satisfies `SolverAdapter` in `apps/api/app/solver/interfaces.py`.
2. Accept `NormalizedStudyInput` and emit `SolverOutcomeResult` objects.
3. Preserve output contract: GLB payload + proxy/real metrics.
4. Inject the new adapter into `JobManager` at app startup.

## Adding manufacturing constraints

- Add explicit constraint schema in `packages/contracts/schema/solve.schema.json`.
- Extend `SolveRequest` models on both frontend and backend.
- Apply constraints in the solver objective/filters (overhang, tool access, min feature size).

## Upgrading persistence

- Replace SQLite repository functions with a Postgres repository layer.
- Keep repository signatures stable to avoid API changes.

## Cloud-scale job execution

- Replace `ThreadPoolExecutor` in `JobManager` with queue-backed workers.
- Keep `/api/jobs/{jobId}` contract unchanged so the frontend polling logic remains valid.
