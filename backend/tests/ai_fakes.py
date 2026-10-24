"""Offline stand-ins for the OpenAI chat models used by the agents.

`FakeStructuredChatModel` is a real LangChain `BaseChatModel`: it answers with JSON text,
and its `with_structured_output(schema)` parses that JSON and, for a Pydantic schema,
validates it with the agent's own output model (so a fake that drifts from the schema fails
the test, like a real model's output would fail parsing).
"""

import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable, RunnableLambda
from pydantic import BaseModel, Field

from app.ai.models import AgentModels, Role
from app.core.config import Settings
from tests.conftest import make_settings

Response = dict[str, Any] | Exception | Callable[[list[BaseMessage]], dict[str, Any]]


class FakeStructuredChatModel(BaseChatModel):
    responses: list[Any]
    calls: list[list[BaseMessage]] = Field(default_factory=list)
    position: int = 0

    @property
    def _llm_type(self) -> str:
        return "fake-structured"

    def _next(self, messages: list[BaseMessage]) -> dict[str, Any]:
        if not self.responses:
            raise RuntimeError("no fake response configured")
        response = self.responses[min(self.position, len(self.responses) - 1)]
        self.position += 1
        self.calls = [*self.calls, messages]
        if isinstance(response, Exception):
            raise response
        return response(messages) if callable(response) else response

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        content = json.dumps(self._next(messages), ensure_ascii=False)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])

    def with_structured_output(self, schema: Any = None, **kwargs: Any) -> Runnable:
        def parse(message: AIMessage) -> Any:
            data = json.loads(str(message.content))
            if isinstance(schema, type) and issubclass(schema, BaseModel):
                return schema.model_validate(data)
            return data

        return self | RunnableLambda(parse)


class FakeAgentModels(AgentModels):
    """`get_chat_model(role)` returns a fake answering with `responses[role]` (one response,
    or a list used in order; the last one repeats)."""

    def __init__(
        self,
        responses: dict[str, Response | Sequence[Response]],
        *,
        settings: Settings | None = None,
        available: bool = True,
        fallback: dict[str, Response | Sequence[Response]] | None = None,
    ) -> None:
        super().__init__(settings or make_settings(Path("unused")))
        self._available = available
        self.models = {role: _fake(r) for role, r in responses.items()}
        self.fallbacks = {role: _fake(r) for role, r in (fallback or {}).items()}

    @property
    def available(self) -> bool:
        return self._available

    def get_chat_model(self, role: Role) -> BaseChatModel:
        if role not in self.models:
            self.models[role] = _fake(RuntimeError(f"no fake for role {role}"))
        return self.models[role]

    def get_fallback_model(self, role: Role) -> BaseChatModel | None:
        return self.fallbacks.get(role)


def _fake(response: Response | Sequence[Response]) -> FakeStructuredChatModel:
    items = list(response) if isinstance(response, (list, tuple)) else [response]
    return FakeStructuredChatModel(responses=items)


def last_prompt(model: BaseChatModel) -> str:
    assert isinstance(model, FakeStructuredChatModel) and model.calls
    return "\n".join(str(m.content) for m in model.calls[-1])


# Fake answers for the fixture plan (tests/test_ai_*.py): see `fixture_plan()`.
SPECIALISTS: dict[str, Response] = {
    "cut": {
        "retakes": [{"first_word": 48, "last_word": 54, "note": "Kept the first take."}],
        "rationale": "The last line restarts the opening and trails off.",
    },
    "caption": {
        "preset_id": "beast",
        "show_emojis": True,
        "highlights": [
            {"word": 13, "emoji": None},
            {"word": 18, "emoji": None},
            {"word": 24, "emoji": "\U0001f4a8"},
            {"word": 34, "emoji": None},
            {"word": 52, "emoji": None},  # inside the cut above: dropped by the Director
            {"word": 1, "emoji": None},  # filler: dropped by the agent
        ],
        "rationale": "Views, three, scroll and strongest carry the point.",
    },
    "zoom": {
        "zooms": [
            {"first_word": 17, "last_word": 19, "style": "punch", "scale": 1.25, "reason": "3 s"},
            {"first_word": 18, "last_word": 19, "style": "punch", "scale": 1.2, "reason": "dup"},
            {"first_word": 30, "last_word": 30, "style": "punch", "scale": 3, "reason": "trick"},
            {"first_word": 50, "last_word": 52, "style": "smooth", "scale": 1.1, "reason": "cut"},
        ],
        "rationale": "Punch in on the claim and the trick.",
    },
    "hook": {
        "options": [
            "Your first 3 seconds decide everything",
            '"Why nobody watches your videos past three seconds, honestly"',
            "Stop the scroll",
        ],
        "best": 0,
        "rationale": "A promise in the creator's words.",
    },
    "music": {
        "track_id": "epic-drums",
        "volume": 0.9,
        "ducking": True,
        "mood": "dramatic",
        "rationale": "Bold claim.",
    },
    "director": {"drop": ["zoom-2"], "hook_option": 2, "rationale": "Keep it tight."},
}


def fixture_plan(duration_ms: int = 20000) -> dict[str, Any]:
    """The basic plan of the fake script (55 words over 20 s)."""
    from app.planning import SourceMeta, build_basic_plan
    from app.transcription.fake import scripted_words

    meta = SourceMeta(
        id="src-1",
        src="projects/p/sources/s/proxy-720p.mp4",
        width=1080,
        height=1920,
        duration_ms=duration_ms,
        title="Hook test",
    )
    return build_basic_plan(meta, scripted_words(duration_ms), [])
