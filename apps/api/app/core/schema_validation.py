from __future__ import annotations

import json
from functools import lru_cache

from fastapi import HTTPException
from jsonschema import Draft202012Validator

from app.core.config import settings


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema_path = settings.repo_root / "packages" / "contracts" / "schema" / "solve.schema.json"
    schema = json.loads(schema_path.read_text())
    return Draft202012Validator(schema)


def validate_solve_payload(payload: dict) -> None:
    errors = sorted(_validator().iter_errors(payload), key=lambda e: e.path)
    if not errors:
        return

    first = errors[0]
    path = ".".join([str(p) for p in first.absolute_path]) or "request"
    raise HTTPException(status_code=422, detail=f"Schema validation failed at '{path}': {first.message}")
