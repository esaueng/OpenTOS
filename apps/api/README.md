# OpenTOS API

FastAPI platform service for durable generative-design projects, preview runs, artifact provenance, and the Study Copilot.

## Setup

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

The default database is `<repo>/data/opentos.db`; artifacts are stored under `<repo>/data/artifacts`. Set `DATABASE_URL` for another SQLAlchemy database and `OPENTOS_DATA_DIR` for a different local root.

## AI

```bash
export OPENAI_API_KEY="..."
export AI_PROVIDER=openai
export AI_MODEL=gpt-5.6-sol
export AI_REASONING_EFFORT=xhigh
```

Without `OPENAI_API_KEY`, Copilot returns deterministic readiness guidance and no provider request is made. Provider configuration lives in `app/core/config.py`; prompts live in `app/ai/prompts`.

## Compatibility and migration

The v3 platform creates separate `*_v3` tables. On startup, legacy v2 studies are idempotently exposed as v3 projects/studies where sufficient source data exists. The v2 tables, artifacts, and endpoints remain intact.

## Test

```bash
.venv/bin/python -m pytest
```
