from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, create_engine, delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class ProjectRecord(Base):
    __tablename__ = "projects_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
    active_study_id: Mapped[str | None] = mapped_column(String(64))
    active_run_id: Mapped[str | None] = mapped_column(String(64))


class ArtifactRecord(Base):
    __tablename__ = "artifacts_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    media_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)


class ModelRevisionRecord(Base):
    __tablename__ = "model_revisions_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts_v3.id"))
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    units: Mapped[str] = mapped_column(String(8), nullable=False)
    model_format: Mapped[str] = mapped_column(String(8), nullable=False)
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class StudyDraftRecord(Base):
    __tablename__ = "study_drafts_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    model_revision_id: Mapped[str] = mapped_column(ForeignKey("model_revisions_v3.id"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class SolverRunRecord(Base):
    __tablename__ = "solver_runs_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    study_id: Mapped[str] = mapped_column(ForeignKey("study_drafts_v3.id"), index=True)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    stage: Mapped[str] = mapped_column(String(40), nullable=False)
    progress: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
    eta_seconds: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    warnings: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    options: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class OutcomeRecord(Base):
    __tablename__ = "outcomes_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("solver_runs_v3.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts_v3.id"))
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)


class AITraceRecord(Base):
    __tablename__ = "ai_traces_v3"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects_v3.id"), index=True)
    study_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_id: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


class PlatformRepository:
    def __init__(self, database_url: str | None = None) -> None:
        url = database_url or settings.database_url
        kwargs: dict[str, Any] = {"future": True, "pool_pre_ping": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 10}
        self.engine: Engine = create_engine(url, **kwargs)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False, class_=Session)

    def initialize(self) -> None:
        settings.data_root.mkdir(parents=True, exist_ok=True)
        settings.artifacts_root.mkdir(parents=True, exist_ok=True)
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        with self._sessions() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    def create_project(self, name: str, *, project_id: str | None = None) -> ProjectRecord:
        now = utc_now()
        record = ProjectRecord(
            id=project_id or f"prj_{uuid.uuid4().hex[:20]}",
            name=name,
            created_at=now,
            updated_at=now,
        )
        with self.session() as session:
            session.add(record)
        return record

    def list_projects(self) -> list[ProjectRecord]:
        with self.session() as session:
            return list(session.scalars(select(ProjectRecord).order_by(ProjectRecord.updated_at.desc())))

    def get_project(self, project_id: str) -> ProjectRecord | None:
        with self.session() as session:
            return session.get(ProjectRecord, project_id)

    def save_artifact(self, project_id: str, artifact: Any) -> ArtifactRecord:
        record = ArtifactRecord(
            id=artifact.id,
            project_id=project_id,
            kind=artifact.kind,
            media_type=artifact.media_type,
            file_name=artifact.file_name,
            byte_size=artifact.byte_size,
            sha256=artifact.sha256,
            storage_path=str(artifact.path),
            created_at=utc_now(),
        )
        with self.session() as session:
            session.add(record)
        return record

    def get_artifact(self, artifact_id: str) -> ArtifactRecord | None:
        with self.session() as session:
            return session.get(ArtifactRecord, artifact_id)

    def create_model_revision(
        self,
        *,
        project_id: str,
        artifact_id: str,
        units: str,
        model_format: str,
        diagnostics: dict[str, Any],
    ) -> ModelRevisionRecord:
        now = utc_now()
        record = ModelRevisionRecord(
            id=f"mdl_{uuid.uuid4().hex[:20]}",
            project_id=project_id,
            artifact_id=artifact_id,
            created_at=now,
            units=units,
            model_format=model_format,
            diagnostics=diagnostics,
        )
        with self.session() as session:
            session.add(record)
            project = session.get(ProjectRecord, project_id)
            if project:
                project.updated_at = now
        return record

    def get_model_revision(self, revision_id: str) -> ModelRevisionRecord | None:
        with self.session() as session:
            return session.get(ModelRevisionRecord, revision_id)

    def create_study(self, project_id: str, payload: dict[str, Any]) -> StudyDraftRecord:
        now = utc_now()
        record = StudyDraftRecord(
            id=f"std_{uuid.uuid4().hex[:20]}",
            project_id=project_id,
            model_revision_id=payload["modelRevisionId"],
            name=payload["name"],
            created_at=now,
            updated_at=now,
            revision=1,
            payload=payload,
        )
        with self.session() as session:
            session.add(record)
            project = session.get(ProjectRecord, project_id)
            if project:
                project.active_study_id = record.id
                project.updated_at = now
        return record

    def get_study(self, study_id: str) -> StudyDraftRecord | None:
        with self.session() as session:
            return session.get(StudyDraftRecord, study_id)

    def create_run(self, project_id: str, study_id: str, options: dict[str, Any]) -> SolverRunRecord:
        now = utc_now()
        record = SolverRunRecord(
            id=f"run_{uuid.uuid4().hex[:20]}",
            project_id=project_id,
            study_id=study_id,
            state="queued",
            stage="queued",
            progress=0.0,
            created_at=now,
            updated_at=now,
            warnings=[],
            options=options,
        )
        with self.session() as session:
            session.add(record)
            project = session.get(ProjectRecord, project_id)
            if project:
                project.active_run_id = record.id
                project.updated_at = now
        return record

    def get_run(self, run_id: str) -> SolverRunRecord | None:
        with self.session() as session:
            return session.get(SolverRunRecord, run_id)

    def update_run(self, run_id: str, **values: Any) -> None:
        with self.session() as session:
            record = session.get(SolverRunRecord, run_id)
            if not record:
                return
            for key, value in values.items():
                setattr(record, key, value)
            record.updated_at = utc_now()

    def save_outcome(
        self,
        *,
        outcome_id: str,
        run_id: str,
        project_id: str,
        artifact_id: str,
        rank: int,
        status: str,
        payload: dict[str, Any],
    ) -> OutcomeRecord:
        record = OutcomeRecord(
            id=outcome_id,
            run_id=run_id,
            project_id=project_id,
            artifact_id=artifact_id,
            rank=rank,
            status=status,
            payload=payload,
            created_at=utc_now(),
        )
        with self.session() as session:
            session.add(record)
        return record

    def list_outcomes(self, run_id: str) -> list[OutcomeRecord]:
        with self.session() as session:
            statement = select(OutcomeRecord).where(OutcomeRecord.run_id == run_id).order_by(OutcomeRecord.rank)
            return list(session.scalars(statement))

    def clear_outcomes(self, run_id: str) -> None:
        with self.session() as session:
            session.execute(delete(OutcomeRecord).where(OutcomeRecord.run_id == run_id))

    def save_ai_trace(self, **values: Any) -> AITraceRecord:
        record = AITraceRecord(id=f"ait_{uuid.uuid4().hex[:20]}", created_at=utc_now(), **values)
        with self.session() as session:
            session.add(record)
        return record
