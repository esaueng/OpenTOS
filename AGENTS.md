# AGENTS.md

## Cursor Cloud specific instructions

### Overview

OpenTOS is an npm workspaces monorepo with two services and a shared contracts package. See `README.md` for full details.

| Service | Path | Stack | Port |
|---------|------|-------|------|
| Web Frontend | `apps/web` | React + Vite + three.js | 5173 |
| API Backend | `apps/api` | Python FastAPI + uvicorn | 8000 |
| Contracts | `packages/contracts` | TypeScript (no build step) | N/A |

### Running services

- **Web (required):** `npm run dev:web` from repo root (or `npm run dev` from `apps/web`). Default solver mode is `browser` (no backend needed).
- **API (optional):** `cd apps/api && source .venv/bin/activate && PYTHONPATH=. uvicorn app.main:app --reload --port 8000`. Only needed when `VITE_SOLVER_MODE=api`.

### Testing

- **Frontend tests:** `npm run test:web` (vitest, 14 tests)
- **Frontend typecheck:** `cd apps/web && npx tsc -b`
- **Backend tests:** `cd apps/api && source .venv/bin/activate && PYTHONPATH=. pytest`

### Gotchas

- Backend tests require `PYTHONPATH=.` when running from `apps/api/` (no `conftest.py` or `pyproject.toml` to handle path resolution).
- The `python3.12-venv` system package must be installed before creating the API virtualenv.
- The 3D viewer (React Three Fiber / three.js) does not render in cloud VMs lacking GPU/WebGL hardware acceleration. UI controls, model loading, and solver execution all work; only the WebGL canvas is blank.
- One backend test (`test_study_create_get_run_and_job_contracts`) has a pre-existing failure (422 vs 200) due to schema validation; 6/7 tests pass.
