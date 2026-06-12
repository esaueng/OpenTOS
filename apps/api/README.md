# OpenTOS API

FastAPI backend for generative design studies.

## Run

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API persists study artifacts under `../../data/studies` and metadata in SQLite at `../../data/opentos.db`.

## Configuration

Optional environment variables (defaults in parentheses):

- `OPENTOS_DATA_DIR`: root directory for SQLite metadata and study artifacts (`<repo>/data`).
- `OPENTOS_MAX_WORKERS`: solver thread pool size (`2`).

## Test

```bash
cd apps/api
python3 -m pytest
```
