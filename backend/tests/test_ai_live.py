"""One real run of the agent graph against OpenAI (costs a few cents).

Skipped unless OPENAI_API_KEY is set in the environment and RUN_LIVE_AI=1:

    RUN_LIVE_AI=1 OPENAI_API_KEY=sk-... uv run pytest -m live_openai -s
"""

import os

import pytest

from app.ai import AgentModels, apply_ai_commands, run_edit_graph, run_plan_graph
from app.core.config import Settings
from app.schemas.edit_plan import EditPlan
from tests.ai_fakes import fixture_plan

pytestmark = [
    pytest.mark.live_openai,
    pytest.mark.skipif(
        not (os.environ.get("OPENAI_API_KEY") and os.environ.get("RUN_LIVE_AI") == "1"),
        reason="needs OPENAI_API_KEY and RUN_LIVE_AI=1",
    ),
]


def _models() -> AgentModels:
    # Model ids from backend/.env / env vars (or the documented defaults).
    return AgentModels(Settings(openai_api_key=os.environ["OPENAI_API_KEY"]))  # type: ignore[call-arg]


async def test_live_plan_graph_on_the_fixture_transcript() -> None:
    plan = fixture_plan()
    result = await run_plan_graph(plan, _models())
    print("warnings:", result.warnings)
    print("changes:", result.changes)
    assert result.failed_agents == [], result.warnings
    assert result.commands
    after, _ = apply_ai_commands(plan, result.commands)
    EditPlan.model_validate(after)
    assert after["hook"]["text"] and len(after["hook"]["text"].split()) <= 8


async def test_live_describe_a_change() -> None:
    result = await run_edit_graph(fixture_plan(), "Make it calmer", _models())
    print(result)
    assert result.ok and result.commands
