"""POST /projects/{pid}/plan/edit ("describe a change") through the HTTP API, fake models."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.main import create_app
from tests.ai_fakes import FakeAgentModels, fixture_plan
from tests.conftest import _client_for, make_settings
from tests.test_ai_graph import CALMER

pytestmark = pytest.mark.integration


async def _client(tmp_path: Path, models: Any, **overrides: Any) -> AsyncIterator[AsyncClient]:
    settings = make_settings(tmp_path, **overrides)
    async for http in _client_for(create_app(settings, agent_models=models)):
        yield http


@pytest.fixture
async def ai_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    models = FakeAgentModels({"edit": CALMER})
    async for http in _client(tmp_path, models, ai_edit_burst=3, ai_edit_per_minute=1):
        yield http


async def _project_with_plan(client: AsyncClient) -> str:
    pid = (await client.post("/api/v1/projects", json={"title": "AI"})).json()["id"]
    saved = await client.put(f"/api/v1/projects/{pid}/plan", json=fixture_plan())
    assert saved.status_code == 200, saved.text
    return pid


async def test_make_it_calmer_returns_commands_without_saving(ai_client: AsyncClient) -> None:
    pid = await _project_with_plan(ai_client)
    response = await ai_client.post(
        f"/api/v1/projects/{pid}/plan/edit", json={"request": "Make it calmer", "plan_revision": 1}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True and body["message"] is None
    assert body["commands"] == CALMER["commands"]  # TS EditCommand JSON, camelCase
    assert body["changes"] == CALMER["changes"]
    assert body["dropped"] == []
    current = (await ai_client.get(f"/api/v1/projects/{pid}/plan")).json()
    assert current["revision"] == 1 and current["plan"]["vibe"] == "energetic"  # not saved


@pytest.mark.parametrize(
    "body",
    [
        {"request": "", "plan_revision": 1},
        {"request": "   ", "plan_revision": 1},
        {"plan_revision": 1},
        {"request": "calmer", "plan_revision": 0},
        {"request": "x" * 2001, "plan_revision": 1},
    ],
)
async def test_bad_requests_are_422(ai_client: AsyncClient, body: dict[str, Any]) -> None:
    pid = await _project_with_plan(ai_client)
    response = await ai_client.post(f"/api/v1/projects/{pid}/plan/edit", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_stale_revision_and_missing_plan(ai_client: AsyncClient) -> None:
    pid = await _project_with_plan(ai_client)
    stale = await ai_client.post(
        f"/api/v1/projects/{pid}/plan/edit", json={"request": "calmer", "plan_revision": 7}
    )
    assert stale.status_code == 412 and stale.json()["error"]["code"] == "revision_mismatch"
    empty = (await ai_client.post("/api/v1/projects", json={"title": "Empty"})).json()["id"]
    missing = await ai_client.post(
        f"/api/v1/projects/{empty}/plan/edit", json={"request": "calmer", "plan_revision": 1}
    )
    assert missing.status_code == 404


async def test_rate_limit_per_project(ai_client: AsyncClient) -> None:
    pid = await _project_with_plan(ai_client)
    other = await _project_with_plan(ai_client)
    body = {"request": "calmer", "plan_revision": 1}
    for _ in range(3):  # burst of 3
        assert (
            await ai_client.post(f"/api/v1/projects/{pid}/plan/edit", json=body)
        ).status_code == 200
    limited = await ai_client.post(f"/api/v1/projects/{pid}/plan/edit", json=body)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    # Another project has its own bucket.
    assert (
        await ai_client.post(f"/api/v1/projects/{other}/plan/edit", json=body)
    ).status_code == 200


async def test_without_a_key_the_endpoint_is_503(client: AsyncClient) -> None:
    pid = await _project_with_plan(client)
    response = await client.post(
        f"/api/v1/projects/{pid}/plan/edit", json={"request": "calmer", "plan_revision": 1}
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"


async def test_model_failure_is_502(tmp_path: Path) -> None:
    models = FakeAgentModels({"edit": RuntimeError("upstream exploded sk-secret")})
    async for client in _client(tmp_path, models):
        pid = await _project_with_plan(client)
        response = await client.post(
            f"/api/v1/projects/{pid}/plan/edit", json={"request": "calmer", "plan_revision": 1}
        )
        assert response.status_code == 502
        error = response.json()["error"]
        assert error["code"] == "ai_error" and "sk-" not in error["message"]


def _events(text: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


async def test_stream_variant(ai_client: AsyncClient) -> None:
    pid = await _project_with_plan(ai_client)
    response = await ai_client.post(
        f"/api/v1/projects/{pid}/plan/edit/stream",
        json={"request": "make it calmer", "plan_revision": 1},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response.text)
    progress = [data for kind, data in events if kind == "progress"]
    assert {"node": "edit_director", "status": "started"} in progress
    kind, result = events[-1]
    assert kind == "result" and result["ok"] and result["commands"] == CALMER["commands"]


async def test_stream_errors_before_running_are_json(ai_client: AsyncClient) -> None:
    pid = await _project_with_plan(ai_client)
    response = await ai_client.post(
        f"/api/v1/projects/{pid}/plan/edit/stream", json={"request": "x", "plan_revision": 9}
    )
    assert response.status_code == 412
