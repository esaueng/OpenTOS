# AGENTS.md

## Cursor Cloud specific instructions

### Overview

OpenTOS is a web-based generative design platform (monorepo). Two services:

| Service | Path | Start command | Port |
|---------|------|---------------|------|
| Web frontend (Vite + React + three.js) | `apps/web` | `npm run dev` (from `apps/web`) | 5173 |
| API backend (FastAPI + Python) | `apps/api` | `source .venv/bin/activate && uvicorn app.main:app --reload --port 8000` (from `apps/api`) | 8000 |

The frontend defaults to **browser solver mode** (no backend required). Set `VITE_SOLVER_MODE=api` and `VITE_API_BASE=http://localhost:8000` in `apps/web/.env.local` to use the API backend.

### Lint / Test / Build

See `README.md` for standard commands. Key notes:

- **Frontend tests**: `npm test` from `apps/web` (runs `vitest run`)
- **Frontend type check**: `npx tsc -b` from `apps/web`
- **Frontend build**: `npm run build` from `apps/web` (runs `tsc -b && vite build`)
- **Backend tests**: `cd apps/api && source .venv/bin/activate && PYTHONPATH=. pytest` — the `PYTHONPATH=.` is required because there is no `pyproject.toml` or `setup.py` to make `app` importable.
- One backend test (`test_study_create_get_run_and_job_contracts`) has a pre-existing failure (422 validation error).

### Caveats

- `python3.12-venv` system package is needed to create the Python virtualenv; the update script handles venv creation.
- The `packages/contracts` workspace has no build step — it exports raw `.ts` sources consumed directly by the web app via npm workspaces.
- The API auto-creates its SQLite database at `data/opentos.db` on first startup; no migration step needed.
