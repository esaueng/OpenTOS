from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db.database import init_db
from app.workers.job_manager import JobManager


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    # Shut down the manager this lifespan created, even if a test swapped
    # app.state.job_manager for a stub in the meantime.
    manager = JobManager()
    app.state.job_manager = manager
    try:
        yield
    finally:
        manager.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(
        title="OpenTOS Generative Design API",
        version="0.1.0",
        description="Autodesk-inspired generative design study service",
        lifespan=_lifespan,
    )

    # The API is unauthenticated and cookie-free, so wildcard origins are
    # acceptable; credentials must stay disabled for that to remain true.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    return app


app = create_app()
