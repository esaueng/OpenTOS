# Architecture

## Product flow

1. A user creates or opens a project.
2. A source mesh becomes an immutable model revision with diagnostics and a content hash.
3. The setup workspace captures regions, load cases, targets, material, and manufacturing constraints as a versioned study draft.
4. Readiness checks block incomplete runs before compute starts.
5. A run creates immutable outcomes with artifacts, checks, warnings, and solver provenance.
6. Results compare outcomes through a table, SVG tradeoff plot, and synchronized 3D viewer.
7. Copilot can inspect bounded project facts and propose reviewed study patches; it cannot mutate a study or start a run.

## Web (`apps/web`)

- React 18, TypeScript, Vite, and route-level lazy loading.
- React Router owns `/projects`, `/projects/:id/setup`, and `/projects/:id/results`.
- TanStack Query owns API project server state.
- Zustand owns the active authoring/result workspace state.
- Three.js owns model rendering, camera control, face picking, force arrows, and mesh disposal.
- React-owned SVG renders the mass/safety plot; the outcome table is the complete accessible fallback.
- URL search parameters own selected `view`, `outcome`, and `metric` state.
- Setup authoring is desktop-only. Results reflow into one natural mobile document scroll.

Runtime adapters:

- `usePreviewSolver`: transfers positions to the browser Web Worker and labels every result as preview.
- `usePlatformSolver`: uploads a model revision, creates a v3 study, starts/polls a durable run, downloads outcome artifacts, and hydrates the same results store.

## API (`apps/api`)

FastAPI middleware provides request IDs, configured CORS, Pydantic validation, and RFC-style problem responses. Routes are split into:

- `/api/v3`: project/model/study/run/artifact/Copilot platform surface.
- `/api`: preserved v2 study/job/material/benchmark compatibility surface.

The platform service separates HTTP handling from:

- SQLAlchemy repository records;
- filesystem content-addressed artifact storage;
- readiness policy;
- legacy data migration;
- background run orchestration;
- provider-independent AI service logic.

Run records are persisted before execution. Queued/running records are recovered after process restart and restarted from the saved study definition. Partial outcomes are cleared before a recovered run executes again.

## Data model

Core v3 records:

- `projects_v3`
- `artifacts_v3`
- `model_revisions_v3`
- `study_drafts_v3`
- `solver_runs_v3`
- `outcomes_v3`
- `ai_traces_v3`

SQLite is the local default. Repository and model definitions are SQLAlchemy-based so a hosted deployment can use Postgres through `DATABASE_URL`. Binary content is kept out of relational rows and referenced through `artifacts_v3`.

Legacy `studies_v2`, constraints, load cases, jobs, outcomes, and benchmarks are not deleted. Startup migration adds linked v3 records without rewriting v2 data.

## AI integration

`OpenAIResponsesProvider` uses one centralized provider/model/reasoning configuration. The request contains:

- a task-specific system prompt loaded from disk;
- JSON-schema structured output;
- project/study/outcome identifiers and bounded facts;
- up to three read-only tool rounds.

Available tools are `inspect_mesh`, `validate_study`, and `list_outcomes`. Tool arguments are validated; raw model bytes and unrestricted filesystem/database access are not exposed. Proposed patch operations always return with `requiresReview` and are not applied server-side.

AI traces record provider, model, latency, success/error state, and request metadata. Secrets and raw model payloads are excluded.

## Solver boundary

The current `FusionApproxSolver` and browser worker share the same broad stages:

1. constraint map;
2. voxelization;
3. load-path proxy fields;
4. density evolution;
5. connectivity/thickness enforcement;
6. surface reconstruction and smoothing;
7. ranking and GLB export.

This is a topology preview, not FEA. `OutcomeV3.status`, `SolverProvenance.fidelity`, UI badges, warnings, and export affordances preserve that distinction. A real verification adapter must supply genuine mesh, material, boundary-condition, convergence, and field evidence before returning `verified`.

## Error and context policy

- API errors use problem JSON with stable `code`, `status`, `detail`, and `requestId` fields.
- Model uploads are size/type checked before persistence.
- Artifact lookup uses IDs and traversal-safe storage paths.
- Copilot context is identifier-based and bounded; no implicit conversation transcript or binary model content is retained.
- The frontend displays preview/verified state with text and shape, not color alone.
