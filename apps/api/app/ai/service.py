from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from app.ai.provider import OpenAIResponsesProvider
from app.core.config import settings
from app.db.platform import PlatformRepository
from app.models.platform import CopilotRequest, CopilotResponse, CopilotStructuredOutput
from app.services.platform_service import PlatformService


PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "study-copilot.system.md"


class CopilotService:
    def __init__(self, platform: PlatformService) -> None:
        self.platform = platform
        self.repository: PlatformRepository = platform.repository
        self.instructions = PROMPT_PATH.read_text(encoding="utf-8")

    def _tool_handlers(self, project_id: str, request: CopilotRequest) -> dict[str, Any]:
        def inspect_mesh() -> dict[str, Any]:
            if not request.studyId:
                return {"available": False, "reason": "No study selected"}
            study = self.platform.require_study(request.studyId)
            revision = self.repository.get_model_revision(study.modelRevisionId)
            return revision.diagnostics if revision else {"available": False, "reason": "Model revision missing"}

        def validate_study() -> dict[str, Any]:
            if not request.studyId:
                return {"ready": False, "blockers": [{"message": "No study selected"}], "warnings": []}
            return self.platform.readiness(request.studyId).model_dump(mode="json")

        def list_outcomes() -> list[dict[str, Any]]:
            selected = set(request.outcomeIds)
            run_ids = {
                outcome.run_id
                for outcome_id in selected
                if (outcome := self._get_outcome_record(outcome_id)) is not None
            }
            rows = [row for run_id in run_ids for row in self.repository.list_outcomes(run_id)]
            return [row.payload for row in rows if not selected or row.id in selected]

        return {
            "inspect_mesh": inspect_mesh,
            "validate_study": validate_study,
            "list_outcomes": list_outcomes,
        }

    def _get_outcome_record(self, outcome_id: str) -> Any | None:
        with self.repository.session() as session:
            from app.db.platform import OutcomeRecord

            return session.get(OutcomeRecord, outcome_id)

    def _fallback(self, request: CopilotRequest) -> CopilotStructuredOutput:
        if request.studyId:
            readiness = self.platform.readiness(request.studyId)
            if readiness.blockers:
                return CopilotStructuredOutput(
                    message=f"The study has {len(readiness.blockers)} blocking setup issue(s). Resolve the readiness checks before running.",
                    proposedPatch=[],
                    requiresReview=False,
                )
            return CopilotStructuredOutput(
                message="The deterministic setup checks pass. Configure OPENAI_API_KEY to enable model-assisted review and outcome explanation.",
                proposedPatch=[],
                requiresReview=False,
            )
        return CopilotStructuredOutput(
            message="Select a study to review. Configure OPENAI_API_KEY to enable model-assisted guidance.",
            proposedPatch=[],
            requiresReview=False,
        )

    def respond(self, project_id: str, request: CopilotRequest) -> CopilotResponse:
        self.platform.require_project(project_id)
        request_material = json.dumps(request.model_dump(mode="json"), sort_keys=True)
        request_hash = hashlib.sha256(request_material.encode("utf-8")).hexdigest()
        response_id: str | None = None
        status = "succeeded"
        error: str | None = None

        try:
            if settings.ai.enabled:
                result = OpenAIResponsesProvider(settings.ai).respond(
                    instructions=self.instructions,
                    message=request.message,
                    handlers=self._tool_handlers(project_id, request),
                )
                output = result.output
                response_id = result.response_id
            else:
                output = self._fallback(request)
        except Exception as exc:
            status = "failed"
            error = str(exc)
            output = self._fallback(request)

        self.repository.save_ai_trace(
            project_id=project_id,
            study_id=request.studyId,
            provider=settings.ai.provider,
            model=settings.ai.model,
            request_hash=request_hash,
            response_id=response_id,
            status=status,
            error=error,
        )
        return CopilotResponse(
            id=f"msg_{uuid.uuid4().hex[:20]}",
            message=output.message,
            model=settings.ai.model,
            provider=settings.ai.provider,
            proposedPatch=output.proposedPatch,
            requiresReview=output.requiresReview,
        )
