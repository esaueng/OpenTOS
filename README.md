# OpenTOS

OpenTOS is a structural generative-design workspace for engineers and makers who need to turn a mesh, boundary conditions, and performance targets into a small set of comparable design candidates. It combines desktop 3D study authoring, durable project/run provenance, an AI study copilot, and a table-first results review experience. The included topology engine is an explicitly labeled preview approximation; it does **not** present proxy stress or safety values as verified FEA.

## What changed in the rebuild

- Project-oriented v3 platform with durable projects, model revisions, study drafts, runs, outcomes, AI traces, and content-addressed artifacts.
- New desktop engineering workspace with guided readiness checks and a runnable sample study.
- Results comparison with a complete outcome table, directly labeled mass-versus-safety SVG plot, synchronized 3D viewer, constraint checks, and solver provenance.
- Mobile results companion with one document scroll; geometry authoring stays desktop-only.
- Configurable OpenAI Responses API integration with structured output, bounded read-only tools, trace persistence, and a deterministic no-key fallback.
- Legacy v2 data and public endpoints remain available. Startup migration exposes existing v2 studies as v3 projects without deleting or rewriting the original records.

## Runtime modes

OpenTOS supports two explicit execution modes:

| Mode | Configuration | Persistence | Intended use |
| --- | --- | --- | --- |
| Browser preview | `VITE_SOLVER_MODE=browser` (default) | Current browser session | Fast local evaluation and static hosting |
| Platform API | `VITE_SOLVER_MODE=api` | SQLite/Postgres metadata + filesystem artifacts | Durable projects, resumable run records, AI copilot |

Both bundled solver paths currently use the OpenTOS voxel approximation. Every generated outcome is marked `preview`. A requested `linear-static` run is downgraded with an explicit warning until a real verification adapter is installed.

## Quick start

Prerequisites: Node.js 20+, npm, and Python 3.12+.

```bash
npm install
python3.12 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
```

Run the API and web app in separate terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173). Choose **Use sample part** for a ready-to-run connecting-rod study with deterministic support, preserved-interface, and load presets.

### Durable platform mode

Create `apps/web/.env.local`:

```dotenv
VITE_SOLVER_MODE=api
VITE_API_BASE=http://localhost:8000
```

Restart the web dev server. Project creation, uploads, studies, runs, artifacts, and Copilot requests will now use `/api/v3`.

## AI configuration

All model settings are centralized in `apps/api/app/core/config.py` and may be overridden with environment variables:

```bash
export OPENAI_API_KEY="..."
export AI_PROVIDER="openai"
export AI_MODEL="gpt-5.6-sol"
export AI_REASONING_EFFORT="xhigh"
export AI_TIMEOUT_SECONDS="90"
```

The defaults match the model and reasoning effort selected for this rebuild. `AI_MODEL` and `AI_REASONING_EFFORT` are deployment configuration, not strings repeated through the codebase. Set `AI_PROVIDER=disabled` to force the deterministic local fallback. API keys are never stored in project data or frontend bundles.

The Copilot uses the Responses API with:

- JSON-schema structured output;
- a maximum of three read-only tool rounds;
- bounded `inspect_mesh`, `validate_study`, and `list_outcomes` tools;
- no raw model bytes in prompts;
- explicit proposed patches that require user review;
- persisted provider/model/latency trace metadata.

## Architecture

```text
React routes + TanStack Query + Zustand
        │
        ├── browser mode ── Web Worker preview solver
        │
        └── API mode ────── FastAPI /api/v3
                                  │
                    SQLAlchemy repository + artifact store
                                  │
                 preview solver / configurable AI provider
```

- `apps/web`: React, TypeScript, Vite, React Router, TanStack Query, Zustand, Three.js, accessible SVG comparison chart.
- `apps/api`: FastAPI, Pydantic, SQLAlchemy, OpenAI Responses API integration, durable run manager.
- `packages/contracts`: shared v2 compatibility and v3 project/run contracts.
- `data/opentos.db`: default SQLite database.
- `data/artifacts`: content-addressed source models, outcomes, logs, and reports.
- `docs/design`: approved visual references and implementation contract.

See [docs/architecture.md](docs/architecture.md) for component and data-flow details.

## API surface

Primary v3 routes:

- `GET|POST /api/v3/projects`
- `POST /api/v3/projects/{projectId}/models`
- `POST /api/v3/projects/{projectId}/studies`
- `GET /api/v3/studies/{studyId}`
- `GET /api/v3/studies/{studyId}/readiness`
- `POST /api/v3/projects/{projectId}/studies/{studyId}/runs`
- `GET /api/v3/runs/{runId}`
- `GET /api/v3/runs/{runId}/events`
- `POST /api/v3/runs/{runId}/cancel`
- `GET /api/v3/artifacts/{artifactId}`
- `POST /api/v3/projects/{projectId}/copilot`
- `POST /api/v3/projects/{projectId}/copilot/events`

The original `/api/studies`, `/api/jobs`, `/api/materials`, and `/api/benchmarks` endpoints are preserved for existing clients.

## Configuration

Backend variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENTOS_DATA_DIR` | `<repo>/data` | Database and artifact root |
| `DATABASE_URL` | SQLite in the data root | SQLAlchemy database URL |
| `STORAGE_BACKEND` | `filesystem` | Artifact storage selection |
| `OPENTOS_MAX_WORKERS` | `2` | Background solver concurrency |
| `OPENTOS_MAX_UPLOAD_BYTES` | `104857600` | Upload limit |
| `OPENTOS_DEFAULT_QUALITY` | `balanced` | Default solver quality |
| `OPENTOS_CORS_ORIGINS` | local Vite origins | Comma-separated browser origins |
| `AI_PROVIDER` | `openai` | AI provider or `disabled` |
| `AI_MODEL` | `gpt-5.6-sol` | Configurable model name |
| `AI_REASONING_EFFORT` | `xhigh` | Responses reasoning effort |
| `OPENAI_API_KEY` | unset | Provider secret; AI is disabled without it |
| `AI_BASE_URL` | unset | Optional compatible provider base URL |
| `AI_TIMEOUT_SECONDS` | `90` | Provider timeout |

## Verification

```bash
npm test
npm run build
npm audit --audit-level=high
```

The test suite covers geometry normalization, solver behavior, repository persistence, v2/v3 API contracts, artifact traversal protection, AI request configuration/tool boundaries, workspace readiness, sample presets, state updates, accessible chart selection, and metric formatting.

## Solver boundary

The bundled engine produces useful geometry alternatives and deterministic comparison metrics, but its stress, displacement, compliance, and safety values are proxies. They must not be used for certification or release decisions. Before approving a part:

1. export the candidate GLB;
2. remesh it in a validated solver;
3. reproduce supports, contacts, materials, and loads;
4. run mesh-convergence and linear/nonlinear checks as appropriate;
5. attach verified results through a real `SolverAdapter` implementation.

See [docs/extension-guide.md](docs/extension-guide.md) and [docs/solver-assumptions.md](docs/solver-assumptions.md).

## Static deployment

The checked-in `wrangler.toml` publishes the browser-mode SPA to Cloudflare assets:

```bash
npm run deploy:cf
```

Use `VITE_SOLVER_MODE=browser` for static deployment. Hosting the durable API requires a Python-compatible service plus persistent database/artifact storage; Cloudflare static assets alone do not provide `/api/v3`.
