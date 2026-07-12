# Extension guide

## Add a verified structural solver

Implement `SolverAdapter` in `apps/api/app/solver/interfaces.py` and inject it into the platform job manager at startup. A verification adapter should:

1. consume the normalized study definition;
2. generate a volume mesh with quality diagnostics;
3. reproduce materials, fixed regions, load vectors, contacts, and units;
4. run the requested structural analysis with convergence checks;
5. emit optimized geometry plus real stress/displacement/safety metrics;
6. attach solver logs and reports as artifacts;
7. return complete `SolverProvenance` and constraint checks;
8. set fidelity to `verified` only after every required check passes.

Do not relabel proxy values as verified. If the external solver is missing, fails, or cannot map a boundary condition, return a failed/warning state with the evidence preserved.

## Command or service adapter

Keep the platform job manager independent of vendor details. A production adapter can call:

- a sandboxed local executable;
- a queue-backed internal solver service;
- a commercial solver API.

Normalize vendor output inside the adapter. Do not leak vendor-specific result structures into the shared v3 API.

## Add manufacturing constraints

`StudyDraftV3.manufacturing` already records minimum thickness, symmetry, overhang angle, and process. A solver adapter must explicitly report which constraints it enforced. Unsupported constraints should produce warnings and `not-run` checks rather than silent acceptance.

## Upgrade persistence

Set `DATABASE_URL` to a supported hosted SQLAlchemy database and add Alembic migrations for schema changes. Keep artifact bytes in durable object storage by implementing the artifact-store interface; preserve artifact IDs, hashes, media types, and download authorization semantics.

## Scale run execution

Replace the in-process executor behind `PlatformJobManager` with a durable queue/worker implementation while preserving:

- create-run idempotency policy;
- persisted state/stage/progress transitions;
- cancellation semantics;
- recovery of interrupted runs;
- `/api/v3/runs/{id}` and event-stream contracts.

## Add an AI provider

Implement the provider boundary used by `CopilotService`. Preserve structured output validation, tool limits, read-only tool semantics, trace redaction, configurable model names, and deterministic fallback behavior. Provider-specific parameters belong in the provider adapter, not prompts or route handlers.

## Break a public contract intentionally

The v2 endpoints and data remain supported. If a future release removes them:

1. publish a deprecation window;
2. provide a v2-to-v3 client migration guide;
3. prove legacy data migration and artifact retention;
4. version the breaking API explicitly;
5. add contract tests for the final v2 release and the replacement.
