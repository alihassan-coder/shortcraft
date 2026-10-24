"""Chat models for the agents: OpenAI through LangChain, one model id per role (settings).

`AgentModels` is the seam for tests: pass a subclass whose `get_chat_model` returns fake
LangChain chat models, and nothing reaches the network.
"""

import os
from typing import Any, Literal

from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable

from app.core.config import Settings

Role = Literal["director", "cut", "caption", "zoom", "hook", "music", "edit"]
ROLES: tuple[Role, ...] = ("director", "cut", "caption", "zoom", "hook", "music", "edit")


class AIUnavailableError(Exception):
    """No OpenAI key (or AI turned off): callers fall back to the non-AI path."""


class AgentModels:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def available(self) -> bool:
        return self.settings.openai_api_key is not None

    def model_name(self, role: Role) -> str:
        return self.settings.agent_model(role)

    def _init(self, model: str) -> BaseChatModel:
        key = self.settings.openai_api_key
        if key is None:
            raise AIUnavailableError("OPENAI_API_KEY is not set")
        return init_chat_model(
            f"openai:{model}",
            api_key=key.get_secret_value(),
            timeout=self.settings.ai_timeout_seconds,
            max_retries=self.settings.ai_max_retries,
        )

    def get_chat_model(self, role: Role) -> BaseChatModel:
        return self._init(self.model_name(role))

    def get_fallback_model(self, role: Role) -> BaseChatModel | None:
        fallback = self.settings.agent_model_fallback
        if not fallback or fallback == self.model_name(role):
            return None
        return self._init(fallback)

    def structured(self, role: Role, schema: Any, *, strict: bool | None) -> Runnable:
        """`model.with_structured_output(schema)` (OpenAI Structured Outputs, json_schema),
        with the fallback model behind it when AGENT_MODEL_FALLBACK is set. Fallbacks wrap
        the structured runnables: a `RunnableWithFallbacks` has no `with_structured_output`."""
        kwargs: dict[str, Any] = {"method": "json_schema", "strict": strict}
        primary = self.get_chat_model(role).with_structured_output(schema, **kwargs)
        fallback = self.get_fallback_model(role)
        if fallback is None:
            return primary
        return primary.with_fallbacks([fallback.with_structured_output(schema, **kwargs)])


def configure_tracing(settings: Settings) -> None:
    """LangSmith reads LANGSMITH_* from the process environment; copy them from settings
    (values already in the environment win). Off unless LANGSMITH_TRACING=true + a key."""
    if not settings.langsmith_tracing or settings.langsmith_api_key is None:
        return
    os.environ.setdefault("LANGSMITH_TRACING", "true")
    os.environ.setdefault("LANGSMITH_API_KEY", settings.langsmith_api_key.get_secret_value())
    if settings.langsmith_project:
        os.environ.setdefault("LANGSMITH_PROJECT", settings.langsmith_project)
    if settings.langsmith_endpoint:
        os.environ.setdefault("LANGSMITH_ENDPOINT", settings.langsmith_endpoint)
