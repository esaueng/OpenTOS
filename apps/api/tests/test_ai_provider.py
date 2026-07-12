from __future__ import annotations

import json
from types import SimpleNamespace

from app.ai.provider import OpenAIResponsesProvider
from app.core.config import AISettings


class FakeResponses:
    def __init__(self) -> None:
        self.requests: list[dict] = []

    def create(self, **kwargs):  # type: ignore[no-untyped-def]
        self.requests.append(kwargs)
        if len(self.requests) == 1:
            return SimpleNamespace(
                id="resp_tool",
                output=[SimpleNamespace(type="function_call", name="validate_study", arguments="{}", call_id="call_1")],
                output_text="",
            )
        return SimpleNamespace(
            id="resp_final",
            output=[],
            output_text=json.dumps(
                {
                    "message": "The study is ready for preview.",
                    "proposedPatch": [],
                    "requiresReview": False,
                }
            ),
        )


def test_responses_provider_preserves_model_effort_tools_and_schema() -> None:
    provider = OpenAIResponsesProvider.__new__(OpenAIResponsesProvider)
    provider.config = AISettings(
        provider="openai",
        model="gpt-5.6-sol",
        reasoning_effort="xhigh",
        api_key="test-key",
        base_url=None,
        timeout_seconds=30,
    )
    fake = FakeResponses()
    provider.client = SimpleNamespace(responses=fake)

    result = provider.respond(
        instructions="Use deterministic evidence.",
        message="Review my study",
        handlers={"validate_study": lambda: {"ready": True, "blockers": []}},
    )

    assert result.response_id == "resp_final"
    assert result.output.message == "The study is ready for preview."
    assert fake.requests[0]["model"] == "gpt-5.6-sol"
    assert fake.requests[0]["reasoning"] == {"effort": "xhigh"}
    assert fake.requests[0]["tools"][0]["strict"] is True
    assert fake.requests[0]["text"]["format"]["type"] == "json_schema"
    continuation = fake.requests[1]["input"][0]
    assert continuation["type"] == "function_call_output"
    assert json.loads(continuation["output"])["ready"] is True
