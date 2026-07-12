from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _int_env(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    return value


def _csv_env(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    values = tuple(item.strip() for item in raw.split(",") if item.strip())
    return values or default


@dataclass(frozen=True)
class AISettings:
    provider: str
    model: str
    reasoning_effort: str
    api_key: str | None
    base_url: str | None
    timeout_seconds: int

    @property
    def enabled(self) -> bool:
        return self.provider != "disabled" and bool(self.api_key)


class Settings:
    """Centralized runtime configuration for local and hosted deployments."""

    def __init__(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[4]
        data_dir = os.environ.get("OPENTOS_DATA_DIR")
        self.data_root = Path(data_dir).expanduser().resolve() if data_dir else self.repo_root / "data"
        self.studies_root = self.data_root / "studies"
        self.artifacts_root = self.data_root / "artifacts"
        self.sqlite_path = self.data_root / "opentos.db"
        self.database_url = os.environ.get("DATABASE_URL", f"sqlite:///{self.sqlite_path}")
        self.storage_backend = os.environ.get("STORAGE_BACKEND", "filesystem")
        self.max_workers = _int_env("OPENTOS_MAX_WORKERS", 2)
        self.max_upload_bytes = _int_env("OPENTOS_MAX_UPLOAD_BYTES", 100 * 1024 * 1024)
        self.default_quality_profile = os.environ.get("OPENTOS_DEFAULT_QUALITY", "balanced")
        self.cors_origins = _csv_env(
            "OPENTOS_CORS_ORIGINS",
            ("http://localhost:5173", "http://127.0.0.1:5173"),
        )
        self.ai = AISettings(
            provider=os.environ.get("AI_PROVIDER", "openai"),
            model=os.environ.get("AI_MODEL", "gpt-5.6-sol"),
            reasoning_effort=os.environ.get("AI_REASONING_EFFORT", "xhigh"),
            api_key=os.environ.get("OPENAI_API_KEY"),
            base_url=os.environ.get("AI_BASE_URL"),
            timeout_seconds=_int_env("AI_TIMEOUT_SECONDS", 90),
        )


settings = Settings()
