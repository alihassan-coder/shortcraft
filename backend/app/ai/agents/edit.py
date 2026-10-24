"""Edit director ("describe a change"): the creator's request -> edit commands.

The output schema is the full agent command union, sent as a plain (non-strict) JSON schema:
strict Structured Outputs can't express optional patch fields, and parsing into a dict lets
the validate step drop one bad command instead of failing the whole reply.
"""

from typing import Any

from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from app.ai.agents.base import call_structured, load_prompt, messages
from app.ai.commands import AgentCommand, openai_friendly_schema
from app.ai.models import AgentModels

NAME = "edit"


class EditReply(BaseModel):
    """Edit commands that make the requested change."""

    ok: bool
    message: str | None
    changes: list[str]
    commands: list[AgentCommand]


def reply_schema() -> dict[str, Any]:
    schema = openai_friendly_schema(EditReply.model_json_schema(by_alias=True))
    schema["title"] = "EditReply"
    return schema


async def run(models: AgentModels, context: str, request: str) -> dict[str, Any]:
    msgs = messages(context, load_prompt(NAME))
    msgs.append(HumanMessage(f"Creator's request: {request}"))
    return await call_structured(models, NAME, reply_schema(), msgs, strict=None)
