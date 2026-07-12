from __future__ import annotations

import hashlib
import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings


@dataclass(frozen=True)
class StoredArtifact:
    id: str
    kind: str
    media_type: str
    file_name: str
    byte_size: int
    sha256: str
    path: Path


class FileSystemArtifactStore:
    """Content-addressed local artifact storage with stable public ids."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.artifacts_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, *, kind: str, file_name: str, content: bytes, media_type: str | None = None) -> StoredArtifact:
        digest = hashlib.sha256(content).hexdigest()
        artifact_id = f"art_{uuid.uuid4().hex[:20]}"
        safe_name = Path(file_name).name or "artifact.bin"
        extension = Path(safe_name).suffix.lower()
        target_dir = self.root / digest[:2] / digest[2:4]
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{digest}{extension}"
        if not target.exists():
            target.write_bytes(content)
        return StoredArtifact(
            id=artifact_id,
            kind=kind,
            media_type=media_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
            file_name=safe_name,
            byte_size=len(content),
            sha256=digest,
            path=target,
        )

    def read(self, path: str | Path) -> bytes:
        target = Path(path).resolve()
        target.relative_to(self.root)
        return target.read_bytes()
