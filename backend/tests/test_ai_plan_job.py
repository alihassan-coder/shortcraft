"""Upload -> proxy -> transcribe -> plan (mode "ai") through the HTTP API, fake models.

Real ffmpeg + the fake transcription provider; the agents answer from fixtures.
"""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import MiB
from app.main import create_app
from app.schemas.edit_plan import EditPlanV2
from tests.ai_fakes import SPECIALISTS, FakeAgentModels
from tests.conftest import _client_for, make_settings
from tests.test_ai_pipeline import _job, _proxy_job
from tests.test_proxy_pipeline import _project, _upload

pytestmark = [pytest.mark.integration, pytest.mark.ffmpeg]

# The 6 s gap clip gets the first 19 words of the fake script (see test_ai_commands' context).
CHAIN_RESPONSES: dict[str, Any] = {
    "cut": {"retakes": [], "rationale": "No retakes beyond the one already cut."},
    "caption": {
        "preset_id": "neon",
        "show_emojis": True,
        "highlights": [{"word": 13, "emoji": "\U0001f440"}, {"word": 17, "emoji": None}],
        "rationale": "views + first",
    },
    "zoom": {
        "zooms": [
            {"first_word": 14, "last_word": 15, "style": "punch", "scale": 1.3, "reason": "claim"}
        ],
        "rationale": "One punch-in on the claim.",
    },
    "hook": SPECIALISTS["hook"],
    "music": SPECIALISTS["music"],
    "director": {"drop": [], "hook_option": 0, "rationale": "Good as is."},
}


async def _chain(tmp_path: Path, models: Any) -> AsyncIterator[AsyncClient]:
    settings = make_settings(
        tmp_path,
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        proxy_on_upload=True,
        transcribe_on_upload=True,
        auto_plan=True,
        ai_plan_enabled=True,
        transcription_provider="fake",
        max_upload_bytes=50 * MiB,
    )
    async for http in _client_for(create_app(settings, agent_models=models)):
        yield http


async def _plan_job(client: AsyncClient, gap_clip: Path) -> tuple[str, str, dict[str, Any]]:
    pid = await _project(client)
    sid = (await _upload(client, pid, gap_clip, "video/mp4"))["id"]
    proxy = await _proxy_job(client, pid, sid)
    assert proxy["status"] == "succeeded", proxy["error"]
    transcribe = await _job(client, pid, proxy["result"]["transcribe_job_id"])
    assert transcribe["status"] == "succeeded", transcribe["error"]
    job = await _job(client, pid, transcribe["result"]["plan_job_id"])
    assert job["status"] == "succeeded", job["error"]
    assert job["params"] == {"mode": "ai", "vibe": "energetic"}
    return pid, sid, job


async def test_upload_chain_builds_an_ai_plan(tmp_path: Path, gap_clip: Path) -> None:
    async for client in _chain(tmp_path, FakeAgentModels(CHAIN_RESPONSES)):
        pid, _sid, job = await _plan_job(client, gap_clip)
        result = job["result"]
        assert result["mode_used"] == "ai" and result["warnings"] == []
        assert result["ai"]["failed_agents"] == []
        assert "Music: Epic Drums" in result["ai"]["changes"]

        plan = (await client.get(f"/api/v1/projects/{pid}/plan")).json()["plan"]
        EditPlanV2.model_validate(plan)
        assert plan["captions"]["presetId"] == "neon"
        assert set(plan["captions"]["highlights"]) == {"w13", "w17"}
        assert plan["captions"]["emojis"] == {"w13": "\U0001f440"}
        assert [(z["startMs"], z["style"], z["scale"]) for z in plan["zooms"]["items"]] == [
            (4490, "punch", 1.3)
        ]
        assert plan["hook"]["text"] == "Your first 3 seconds decide everything"
        assert len(plan["hook"]["options"]) == 3
        assert plan["music"]["trackId"] == "epic-drums"
        # The basic cuts are still there; the AI never touched the video file.
        assert {"silence", "filler", "retake"} <= {c["reason"] for c in plan["cuts"]["items"]}
        assert plan["sources"][0]["src"].endswith("proxy-720p.mp4")


async def test_without_a_key_the_ai_plan_falls_back_to_basic(
    tmp_path: Path, gap_clip: Path
) -> None:
    async for client in _chain(tmp_path, None):  # real AgentModels, OPENAI_API_KEY unset
        pid, _, job = await _plan_job(client, gap_clip)
        result = job["result"]
        assert result["mode_used"] == "basic" and result["ai"] is None
        assert result["warnings"] == [
            "AI agents are not configured (no OPENAI_API_KEY); saved the basic edit"
        ]
        plan = (await client.get(f"/api/v1/projects/{pid}/plan")).json()["plan"]
        assert plan["captions"]["presetId"] == "bold-pop"  # the basic edit


async def test_when_every_agent_fails_the_basic_plan_is_saved(
    tmp_path: Path, gap_clip: Path
) -> None:
    models = FakeAgentModels({role: RuntimeError("down") for role in CHAIN_RESPONSES})
    async for client in _chain(tmp_path, models):
        pid, _, job = await _plan_job(client, gap_clip)
        result = job["result"]
        assert result["mode_used"] == "basic"
        assert "cut agent failed (RuntimeError: down)" in result["warnings"]
        assert result["warnings"][-1] == "AI agents suggested no changes; saved the basic edit"
        plan = (await client.get(f"/api/v1/projects/{pid}/plan")).json()
        assert plan["revision"] == 1


async def test_plan_mode_ai_is_accepted_by_the_jobs_api(tmp_path: Path) -> None:
    async for client in _chain(tmp_path, FakeAgentModels(CHAIN_RESPONSES)):
        pid = await _project(client)
        ok = await client.post(
            f"/api/v1/projects/{pid}/jobs", json={"kind": "plan", "params": {"mode": "ai"}}
        )
        assert ok.status_code == 202
        bad = await client.post(
            f"/api/v1/projects/{pid}/jobs", json={"kind": "plan", "params": {"mode": "magic"}}
        )
        assert bad.status_code == 422
