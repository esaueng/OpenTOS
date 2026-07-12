from __future__ import annotations

import base64
import json
import logging
import sqlite3

from app.core.config import settings
from app.models.platform import (
    ConstraintSet,
    ManufacturingConstraints,
    StudyDraftCreate,
)
from app.services.platform_service import PlatformService


logger = logging.getLogger(__name__)


def import_legacy_studies(platform: PlatformService) -> int:
    """Idempotently expose legacy studies as v3 projects without deleting v2 data."""

    if not settings.sqlite_path.exists():
        return 0
    with sqlite3.connect(settings.sqlite_path) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        if "studies_v2" not in tables:
            return 0
        rows = connection.execute("SELECT id, request_json FROM studies_v2 ORDER BY created_at").fetchall()

    imported = 0
    for study_id, raw_request in rows:
        project_id = f"legacy_{study_id}"
        if platform.repository.get_project(project_id):
            continue
        try:
            request = json.loads(raw_request)
            project = platform.repository.create_project(f"Imported {study_id}", project_id=project_id)
            model = request["model"]
            content = base64.b64decode(model["dataBase64"], validate=True)
            revision = platform.add_model_revision(
                project_id=project.id,
                file_name=f"{study_id}.{model['format']}",
                content=content,
                units=request["units"],
            )
            draft = StudyDraftCreate(
                modelRevisionId=revision.id,
                name=f"Imported {study_id}",
                units=request["units"],
                material=request["material"],
                constraints=ConstraintSet(
                    designRegion=request["designRegion"],
                    preservedRegions=request["preservedRegions"],
                    obstacleRegions=request.get("obstacleRegions", []),
                ),
                loadCases=request["loadCases"],
                targets=request["targets"],
                manufacturing=ManufacturingConstraints(
                    minimumThickness=1.0 if request["units"] == "mm" else 0.04,
                    process="unconstrained",
                ),
            )
            platform.create_study(project.id, draft)
            imported += 1
        except Exception:
            logger.exception("Could not import legacy study %s; v2 data remains untouched", study_id)
    return imported
