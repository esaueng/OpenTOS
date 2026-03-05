from __future__ import annotations

import json
from functools import lru_cache

from fastapi import HTTPException
from jsonschema import Draft202012Validator

from app.core.config import settings


@lru_cache(maxsize=1)
def _study_validator() -> Draft202012Validator:
    schema_path = settings.repo_root / "packages" / "contracts" / "schema" / "study-create.schema.json"
    schema = json.loads(schema_path.read_text())
    return Draft202012Validator(schema)


@lru_cache(maxsize=1)
def _run_options_validator() -> Draft202012Validator:
    schema_path = settings.repo_root / "packages" / "contracts" / "schema" / "study-run-options.schema.json"
    schema = json.loads(schema_path.read_text())
    return Draft202012Validator(schema)


def _raise_first_schema_error(errors: list) -> None:
    if not errors:
        return
    first = errors[0]
    path = ".".join([str(p) for p in first.absolute_path]) or "request"
    raise HTTPException(status_code=422, detail=f"Schema validation failed at '{path}': {first.message}")


def validate_study_payload(payload: dict) -> None:
    errors = sorted(_study_validator().iter_errors(payload), key=lambda e: e.path)
    _raise_first_schema_error(errors)


def validate_run_options_payload(payload: dict) -> None:
    errors = sorted(_run_options_validator().iter_errors(payload), key=lambda e: e.path)
    _raise_first_schema_error(errors)


def validate_solve_payload(payload: dict) -> None:
    # Backward shim for any stale imports inside the codebase during transition.
    validate_study_payload(payload)
