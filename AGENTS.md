# AGENTS.md

## Repo overview

OpenTOS is a monorepo for a generative-design application:

- `apps/web`: React + TypeScript + Vite frontend with three.js.
- `apps/api`: FastAPI backend for study/job APIs and solver orchestration.
- `packages/contracts`: shared TypeScript contracts and schema assets.
- `assets/samples`: sample meshes for manual testing.
- `docs`: architecture, solver assumptions, and extension notes.

## Tooling and package managers

- Node.js is used for the web app and workspace packages.
- npm workspaces are configured at the repo root.
- Python is used for the API and is managed with a local virtualenv in `apps/api/.venv`.

## Install and run

### Frontend

From the repo root:

- Install dependencies: `npm install`
- Start the web app: `npm run dev:web`
- Build the web app: `npm run build:web`
- Run frontend tests: `npm run test:web`

From `apps/web` directly:

- Start dev server: `npm run dev`
- Build: `npm run build`
- Run tests: `npm test`

### Backend

From `apps/api`:

- Create venv: `python3 -m venv .venv`
- Activate venv: `source .venv/bin/activate`
- Install dependencies: `pip install -r requirements.txt`
- Start API: `uvicorn app.main:app --reload --port 8000`
- Run tests: `pytest`

The API stores study artifacts in `data/studies` and metadata in `data/opentos.db`.

## Preferred local development workflow

- For most frontend/UI work, prefer browser solver mode because it avoids backend setup.
- The web app defaults to browser mode. To force it explicitly, create `apps/web/.env.local` with `VITE_SOLVER_MODE=browser`.
- Only switch to API mode when the task requires backend behavior or contract validation across the HTTP boundary.

## Contracts and cross-package changes

- If API request/response shapes change, update both `apps/api` and `packages/contracts`.
- When relevant, verify the frontend still matches the backend payload shape instead of changing only one side.
- Keep JSON schema and exported TypeScript types aligned when modifying shared contracts.

## Testing guidance

- Run the narrowest high-signal test suite for the files you changed.
- Frontend targeted tests usually live under `apps/web/src/**/*.test.ts`.
- Backend targeted tests live under `apps/api/tests`.
- There is no dedicated lint script in the root `package.json`; for frontend changes, use `npm run build:web` as the main compile/type/build validation step unless you add or update a more specific test.
- For backend API changes, prefer targeted `pytest` runs first, then broaden only if needed.

Examples:

- Frontend single test file: `npm --workspace @opentos/web run test -- src/lib/studyState.test.ts`
- Backend single test file: `pytest tests/test_api_contract.py`

## Manual testing notes

- Use the sample part in `assets/samples` or the UI button `Load Sample Connecting Rod` for fast end-to-end checks.
- For UI changes, validate behavior in the browser at `http://localhost:5173`.
- For backend-connected flows, run the API on port `8000` and set `VITE_SOLVER_MODE=api` in `apps/web/.env.local`.
- When testing generative-study flows, verify progress updates and outcome rendering rather than only confirming page load.

## Cloudflare deployment

- Cloudflare deploys from the repo root with `wrangler.toml`.
- Preferred deploy command: `npx wrangler deploy`
- The checked-in build step already runs `npm run build:web`.
- Published SPA assets come from `apps/web/dist`.

## Files worth reading before larger changes

- `README.md`
- `apps/api/README.md`
- `docs/solver-assumptions.md`
- `docs/extension-guide.md`
- `wrangler.toml`

## Cursor Cloud specific instructions

- Start by reading this file and `README.md`.
- Prefer `ReadFile`, `Glob`, and `rg` for codebase exploration over ad hoc shell file reads.
- For UI-only changes, run the frontend in browser solver mode unless the task explicitly needs the API.
- For UI changes, do manual browser testing and capture a video walkthrough.
- Leave dev servers running after testing unless cleanup is required to proceed.
- Do not add new dependencies unless the task requires them.
- Before finishing a code change, stage the relevant files, create a descriptive git commit, and push the current branch.
