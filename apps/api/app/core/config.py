from __future__ import annotations

from pathlib import Path


class Settings:
    def __init__(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[4]
        self.data_root = self.repo_root / "data"
        self.studies_root = self.data_root / "studies"
        self.sqlite_path = self.data_root / "opentos.db"
        self.max_workers = 2
        self.default_quality_profile = "balanced"


settings = Settings()
