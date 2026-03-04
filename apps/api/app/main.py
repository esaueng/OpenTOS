from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db.database import init_db
from app.workers.job_manager import JobManager


def create_app() -> FastAPI:
    app = FastAPI(
        title="OpenTOS Generative Design API",
        version="0.1.0",
        description="Autodesk-inspired generative design study service",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup() -> None:
        init_db()
        app.state.job_manager = JobManager()

    app.include_router(router)

    return app


app = create_app()
