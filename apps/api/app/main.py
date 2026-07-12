from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.service import CopilotService
from app.api.platform_routes import router as platform_router
from app.api.routes import router as compatibility_router
from app.core.config import settings
from app.db.database import init_db
from app.services.legacy_migration import import_legacy_studies
from app.services.platform_service import PlatformService
from app.workers.job_manager import JobManager
from app.workers.platform_job_manager import PlatformJobManager


logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    compatibility_manager = JobManager()
    platform = PlatformService()
    platform.initialize()
    import_legacy_studies(platform)
    platform_jobs = PlatformJobManager(platform)
    platform_jobs.recover_interrupted()
    app.state.job_manager = compatibility_manager
    app.state.platform_service = platform
    app.state.platform_jobs = platform_jobs
    app.state.copilot_service = CopilotService(platform)
    try:
        yield
    finally:
        platform_jobs.shutdown()
        compatibility_manager.shutdown()


def _problem(
    request: Request,
    *,
    status: int,
    title: str,
    detail: str,
    code: str,
    errors: list[dict[str, str]] | None = None,
) -> JSONResponse:
    body = {
        "type": f"https://opentos.dev/problems/{code}",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": str(request.url.path),
        "code": code,
        "requestId": getattr(request.state, "request_id", None),
    }
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def create_app() -> FastAPI:
    app = FastAPI(
        title="OpenTOS API",
        version="3.0.0",
        description="Project-oriented structural generative design, solver, and Study Copilot API",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        value = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:20]}"
        request.state.request_id = value
        response = await call_next(request)
        response.headers["X-Request-ID"] = value
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code", "http_error"))
            detail = str(exc.detail.get("message", exc.detail))
        else:
            code = "http_error"
            detail = str(exc.detail)
        return _problem(
            request,
            status=exc.status_code,
            title="Request failed",
            detail=detail,
            code=code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
            for error in exc.errors()
        ]
        return _problem(
            request,
            status=422,
            title="Validation failed",
            detail="The request did not match the API contract.",
            code="validation_failed",
            errors=errors,
        )

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled request error", exc_info=exc)
        return _problem(
            request,
            status=500,
            title="Internal server error",
            detail="The request could not be completed.",
            code="internal_error",
        )

    app.include_router(platform_router)
    app.include_router(compatibility_router)
    return app


app = create_app()
