# Extension Guide

## Replacing the MVP solver with real FEA/topology optimization

1. Implement a new class that satisfies `SolverAdapter` in `apps/api/app/solver/interfaces.py`.
2. Accept `NormalizedStudyInputV2` and emit `SolverOutcomeResult` objects.
3. Preserve output contract: GLB payload + proxy/real metrics.
4. Inject the new adapter into `JobManager` at app startup.

## Adding manufacturing constraints

- Extend v2 study schemas (`packages/contracts/schema/study-create.schema.json`).
- Extend `StudyCreateRequest` / `RunOptions` models on both frontend and backend.
- Apply constraints in the solver objective/filters (overhang, tool access, min feature size).

## Upgrading persistence

- Replace SQLite repository functions with a Postgres repository layer.
- Keep repository signatures stable to avoid API changes.

## Cloud-scale job execution

- Replace `ThreadPoolExecutor` in `JobManager` with queue-backed workers.
- Keep `/api/jobs/{jobId}` contract unchanged so the frontend polling logic remains valid.
