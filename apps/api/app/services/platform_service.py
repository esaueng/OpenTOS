from __future__ import annotations

import io
from pathlib import Path

import trimesh

from app.core.config import settings
from app.db.platform import ArtifactRecord, ModelRevisionRecord, PlatformRepository, ProjectRecord, StudyDraftRecord
from app.models.platform import (
    ArtifactRef,
    MeshDiagnostics,
    ModelRevision,
    ProjectSummary,
    StudyDraft,
    StudyDraftCreate,
    StudyReadiness,
)
from app.services.readiness import evaluate_readiness
from app.storage.artifacts import FileSystemArtifactStore


MEDIA_TYPES = {
    "stl": "model/stl",
    "obj": "model/obj",
    "glb": "model/gltf-binary",
}


class PlatformService:
    def __init__(
        self,
        repository: PlatformRepository | None = None,
        artifact_store: FileSystemArtifactStore | None = None,
    ) -> None:
        self.repository = repository or PlatformRepository()
        self.artifacts = artifact_store or FileSystemArtifactStore()

    def initialize(self) -> None:
        self.repository.initialize()

    @staticmethod
    def project_response(record: ProjectRecord) -> ProjectSummary:
        return ProjectSummary(
            id=record.id,
            name=record.name,
            createdAt=record.created_at,
            updatedAt=record.updated_at,
            activeStudyId=record.active_study_id,
            activeRunId=record.active_run_id,
        )

    @staticmethod
    def artifact_response(record: ArtifactRecord) -> ArtifactRef:
        return ArtifactRef(
            id=record.id,
            kind=record.kind,
            mediaType=record.media_type,
            fileName=record.file_name,
            byteSize=record.byte_size,
            sha256=record.sha256,
            downloadUrl=f"/api/v3/artifacts/{record.id}",
        )

    def create_project(self, name: str) -> ProjectSummary:
        return self.project_response(self.repository.create_project(name))

    def list_projects(self) -> list[ProjectSummary]:
        return [self.project_response(record) for record in self.repository.list_projects()]

    def require_project(self, project_id: str) -> ProjectRecord:
        record = self.repository.get_project(project_id)
        if record is None:
            raise LookupError(f"Project '{project_id}' not found")
        return record

    @staticmethod
    def _load_mesh(content: bytes, model_format: str) -> tuple[trimesh.Trimesh, int]:
        loaded = trimesh.load(io.BytesIO(content), file_type=model_format, process=False)
        if isinstance(loaded, trimesh.Scene):
            bodies = [geometry for geometry in loaded.geometry.values() if isinstance(geometry, trimesh.Trimesh)]
            if not bodies:
                raise ValueError("Model contains no mesh geometry")
            return trimesh.util.concatenate(bodies), len(bodies)
        if not isinstance(loaded, trimesh.Trimesh):
            raise ValueError("Model is not a supported triangle mesh")
        body_count = max(1, len(loaded.split(only_watertight=False)))
        return loaded, body_count

    def add_model_revision(
        self,
        *,
        project_id: str,
        file_name: str,
        content: bytes,
        units: str,
    ) -> ModelRevision:
        self.require_project(project_id)
        if not content:
            raise ValueError("Uploaded model is empty")
        if len(content) > settings.max_upload_bytes:
            raise ValueError(f"Uploaded model exceeds the {settings.max_upload_bytes} byte limit")
        model_format = Path(file_name).suffix.lower().removeprefix(".")
        if model_format not in MEDIA_TYPES:
            raise ValueError("Only STL, OBJ, and GLB models are supported")

        mesh, body_count = self._load_mesh(content, model_format)
        warnings: list[str] = []
        if not mesh.is_watertight:
            warnings.append("Mesh is not watertight; volume and solver preparation may be unreliable.")
        if not mesh.is_winding_consistent:
            warnings.append("Mesh winding is inconsistent and should be repaired before validated analysis.")
        if body_count > 1:
            warnings.append(f"Mesh contains {body_count} disconnected bodies.")
        diagnostics = MeshDiagnostics(
            triangleCount=int(len(mesh.faces)),
            vertexCount=int(len(mesh.vertices)),
            bodyCount=body_count,
            watertight=bool(mesh.is_watertight),
            windingConsistent=bool(mesh.is_winding_consistent),
            bounds=tuple(float(value) for value in mesh.extents),
            warnings=warnings,
        )

        stored = self.artifacts.put(
            kind="source-model",
            file_name=file_name,
            content=content,
            media_type=MEDIA_TYPES[model_format],
        )
        artifact = self.repository.save_artifact(project_id, stored)
        revision = self.repository.create_model_revision(
            project_id=project_id,
            artifact_id=artifact.id,
            units=units,
            model_format=model_format,
            diagnostics=diagnostics.model_dump(mode="json"),
        )
        return self.model_revision_response(revision, artifact)

    def model_revision_response(
        self,
        revision: ModelRevisionRecord,
        artifact: ArtifactRecord | None = None,
    ) -> ModelRevision:
        source = artifact or self.repository.get_artifact(revision.artifact_id)
        if source is None:
            raise RuntimeError(f"Artifact '{revision.artifact_id}' is missing")
        return ModelRevision(
            id=revision.id,
            projectId=revision.project_id,
            createdAt=revision.created_at,
            units=revision.units,
            format=revision.model_format,
            source=self.artifact_response(source),
            diagnostics=MeshDiagnostics(**revision.diagnostics),
        )

    @staticmethod
    def study_response(record: StudyDraftRecord) -> StudyDraft:
        return StudyDraft(
            id=record.id,
            projectId=record.project_id,
            createdAt=record.created_at,
            updatedAt=record.updated_at,
            revision=record.revision,
            **record.payload,
        )

    def create_study(self, project_id: str, request: StudyDraftCreate) -> StudyDraft:
        self.require_project(project_id)
        revision = self.repository.get_model_revision(request.modelRevisionId)
        if revision is None or revision.project_id != project_id:
            raise ValueError("Study model revision does not belong to this project")
        return self.study_response(self.repository.create_study(project_id, request.model_dump(mode="json")))

    def require_study(self, study_id: str) -> StudyDraft:
        record = self.repository.get_study(study_id)
        if record is None:
            raise LookupError(f"Study '{study_id}' not found")
        return self.study_response(record)

    def readiness(self, study_id: str) -> StudyReadiness:
        return evaluate_readiness(self.require_study(study_id))
