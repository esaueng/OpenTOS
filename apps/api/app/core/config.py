from __future__ import annotations

import os
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value < 1:
        raise ValueError(f"{name} must be >= 1, got {value}")
    return value


class Settings:
    """Runtime configuration.

    Defaults keep all state under the repository's ``data/`` directory; the
    optional environment variables below override them for deployments:

    - ``OPENTOS_DATA_DIR``: root directory for SQLite metadata and artifacts.
    - ``OPENTOS_MAX_WORKERS``: solver thread pool size (default 2).
    """

    def __init__(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[4]
        data_dir = os.environ.get("OPENTOS_DATA_DIR")
        self.data_root = Path(data_dir).resolve() if data_dir else self.repo_root / "data"
        self.studies_root = self.data_root / "studies"
        self.sqlite_path = self.data_root / "opentos.db"
        self.max_workers = _int_env("OPENTOS_MAX_WORKERS", 2)
        self.default_quality_profile = "balanced"


settings = Settings()
