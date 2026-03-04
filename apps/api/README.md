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
