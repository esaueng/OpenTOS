from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.core.config import AISettings
from app.models.platform import CopilotStructuredOutput


ToolHandler = Callable[..., dict[str, Any] | list[Any]]


@dataclass(frozen=True)
class AIResult:
    output: CopilotStructuredOutput
    response_id: str | None


class OpenAIResponsesProvider:
    """Small Responses API adapter with bounded read-only tool use."""

    def __init__(self, config: AISettings) -> None:
        if not config.api_key:
            raise ValueError("OPENAI_API_KEY is required for the OpenAI provider")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("The openai package is not installed") from exc

        kwargs: dict[str, Any] = {"api_key": config.api_key, "timeout": config.timeout_seconds}
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self.client = OpenAI(**kwargs)
        self.config = config

    @staticmethod
    def _tool_specs(handlers: dict[str, ToolHandler]) -> list[dict[str, Any]]:
        descriptions = {
            "inspect_mesh": "Return stored mesh diagnostics for the current model revision.",
            "validate_study": "Return deterministic readiness blockers and warnings for the current study.",
            "list_outcomes": "Return selected outcome metrics, checks, status, and solver provenance.",
        }
        return [
            {
                "type": "function",
                "name": name,
                "description": descriptions[name],
                "strict": True,
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            }
            for name in handlers
        ]

    @staticmethod
    def _text_format() -> dict[str, Any]:
        schema = CopilotStructuredOutput.model_json_schema()
        return {
            "format": {
                "type": "json_schema",
                "name": "opentos_copilot_response",
                "strict": True,
                "schema": schema,
            }
        }

    def respond(
        self,
        *,
        instructions: str,
        message: str,
        handlers: dict[str, ToolHandler],
    ) -> AIResult:
        request: dict[str, Any] = {
            "model": self.config.model,
            "reasoning": {"effort": self.config.reasoning_effort},
            "instructions": instructions,
            "input": [{"role": "user", "content": message}],
            "tools": self._tool_specs(handlers),
            "parallel_tool_calls": False,
            "text": self._text_format(),
        }
        response = self.client.responses.create(**request)

        for _ in range(3):
            calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
            if not calls:
                break
            outputs: list[dict[str, str]] = []
            for call in calls:
                handler = handlers.get(call.name)
                if handler is None:
                    result: Any = {"error": f"Unknown tool {call.name}"}
                else:
                    arguments = json.loads(call.arguments or "{}")
                    result = handler(**arguments)
                outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.call_id,
                        "output": json.dumps(result, separators=(",", ":")),
                    }
                )
            response = self.client.responses.create(
                model=self.config.model,
                reasoning={"effort": self.config.reasoning_effort},
                instructions=instructions,
                previous_response_id=response.id,
                input=outputs,
                tools=self._tool_specs(handlers),
                parallel_tool_calls=False,
                text=self._text_format(),
            )

        if not response.output_text:
            raise RuntimeError("The model returned no structured response")
        return AIResult(
            output=CopilotStructuredOutput.model_validate_json(response.output_text),
            response_id=response.id,
        )
