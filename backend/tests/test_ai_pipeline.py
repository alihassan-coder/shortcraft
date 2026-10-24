"""Upload -> proxy -> transcribe -> plan (basic), end to end through the HTTP API.

InProcessJobQueue + LocalStorage + the fake transcription provider; real ffmpeg.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import MiB
from app.main import create_app
from app.planning.basic import RETAKE_NOTE
from app.schemas.edit_plan import EditPlanV2
from app.transcription import FakeProvider, TranscriptionError
from tests.conftest import _client_for, make_settings
from tests.test_proxy_pipeline import TERMINAL, _project, _upload

pytestmark = [pytest.mark.integration, pytest.mark.ffmpeg]


@pytest.fixture
async def chain_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    settings = make_settings(
        tmp_path,
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        proxy_on_upload=True,
        transcribe_on_upload=True,
        auto_plan=True,
        transcription_provider="fake",
        max_upload_bytes=50 * MiB,
    )
    async for http in _client_for(create_app(settings)):
        yield http


async def _job(client: AsyncClient, pid: str, job_id: str, limit_s: float = 90) -> dict[str, Any]:
    async with asyncio.timeout(limit_s):
        while True:
            job = (await client.get(f"/api/v1/projects/{pid}/jobs/{job_id}")).json()
            if job["status"] in TERMINAL:
                return job
            await asyncio.sleep(0.1)


async def _proxy_job(client: AsyncClient, pid: str, sid: str) -> dict[str, Any]:
    async with asyncio.timeout(90):
        while True:
            job = (await client.get(f"/api/v1/projects/{pid}/sources/{sid}")).json()["proxy_job"]
            if job and job["status"] in TERMINAL:
                return job
            await asyncio.sleep(0.1)


async def test_upload_chain_builds_a_basic_plan(chain_client: AsyncClient, gap_clip: Path) -> None:
    client = chain_client
    pid = await _project(client)
    sid = (await _upload(client, pid, gap_clip, "video/mp4"))["id"]

    proxy = await _proxy_job(client, pid, sid)
    assert proxy["status"] == "succeeded", proxy["error"]
    transcribe = await _job(client, pid, proxy["result"]["transcribe_job_id"])
    assert transcribe["status"] == "succeeded", transcribe["error"]
    assert transcribe["kind"] == "transcribe" and transcribe["source_id"] == sid
    assert transcribe["result"]["provider"] == "fake"
    assert transcribe["result"]["word_count"] > 10
    assert transcribe["result"]["filler_count"] >= 1
    plan_job = await _job(client, pid, transcribe["result"]["plan_job_id"])
    assert plan_job["status"] == "succeeded", plan_job["error"]
    assert plan_job["params"] == {"mode": "basic", "vibe": "energetic"}
    assert plan_job["result"]["revision"] == 1
    assert plan_job["result"]["silences_detected"] >= 1  # the 1 s gap in the audio

    detail = (await client.get(f"/api/v1/projects/{pid}/sources/{sid}")).json()
    assert detail["transcript_word_count"] == transcribe["result"]["word_count"]
    assert detail["transcript_language"] == "en"
    transcript_url = detail["urls"]["transcript"]["url"]
    transcript = (await client.get(transcript_url.removeprefix("http://test"))).json()
    assert len(transcript["words"]) == detail["transcript_word_count"]

    response = await client.get(f"/api/v1/projects/{pid}/plan")
    assert response.status_code == 200
    assert response.headers["etag"] == '"1"'
    plan = response.json()["plan"]
    EditPlanV2.model_validate(plan)
    assert plan["version"] == 2
    source = plan["sources"][0]
    assert source["id"] == sid
    assert source["src"] == f"projects/{pid}/sources/{sid}/proxy-720p.mp4"  # stored as a key
    assert len(source["words"]) == detail["transcript_word_count"]
    reasons = {c["reason"] for c in plan["cuts"]["items"]}
    assert {"silence", "filler", "retake"} <= reasons
    retake = next(c for c in plan["cuts"]["items"] if c["reason"] == "retake")
    assert retake["note"] == RETAKE_NOTE
    assert plan["captions"]["enabled"] and plan["captions"]["presetId"] == "bold-pop"
    assert plan["captions"]["highlights"]
    assert plan["music"]["trackId"] == "summer-fun"

    # Resolved copy: the key becomes a playable URL; everything else is the same.
    resolved = await client.get(f"/api/v1/projects/{pid}/plan/resolved")
    assert resolved.status_code == 200
    body = resolved.json()
    assert body["revision"] == 1 and body["expires_in"] is None
    src = body["plan"]["sources"][0]["src"]
    assert src == f"http://test/api/v1/projects/{pid}/sources/{sid}/files/proxy-720p.mp4"
    video = await client.get(src.removeprefix("http://test"))
    assert video.status_code == 200 and video.headers["content-type"] == "video/mp4"
    assert body["plan"]["cuts"] == plan["cuts"]

    # Asking again by hand with another vibe saves the next revision.
    created = await client.post(
        f"/api/v1/projects/{pid}/jobs",
        json={"kind": "plan", "source_id": sid, "params": {"vibe": "clean"}},
    )
    assert created.status_code == 202, created.text
    again = await _job(client, pid, created.json()["id"])
    assert again["status"] == "succeeded", again["error"]
    current = (await client.get(f"/api/v1/projects/{pid}/plan")).json()
    assert current["revision"] == 2
    assert current["plan"]["vibe"] == "clean"
    assert current["plan"]["captions"]["presetId"] == "clean"
    assert current["plan"]["music"]["trackId"] == "just-chill"


async def test_transcription_failure_fails_the_job(
    chain_client: AsyncClient, gap_clip: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def down(self: FakeProvider, audio_path: Path, language: str | None) -> Any:
        raise TranscriptionError("provider is down")

    monkeypatch.setattr(FakeProvider, "transcribe", down)
    client = chain_client
    pid = await _project(client)
    sid = (await _upload(client, pid, gap_clip, "video/mp4"))["id"]
    proxy = await _proxy_job(client, pid, sid)
    assert proxy["status"] == "succeeded", proxy["error"]
    job = await _job(client, pid, proxy["result"]["transcribe_job_id"])
    assert job["status"] == "failed"
    assert job["error"] == "Transcription failed: provider is down"
    assert job["result"] is None
    assert (await client.get(f"/api/v1/projects/{pid}/plan")).status_code == 404
    detail = (await client.get(f"/api/v1/projects/{pid}/sources/{sid}")).json()
    assert detail["transcript_word_count"] is None
    assert detail["status"] == "ready"  # the proxy artifacts are still usable

    # A plan job without a transcript fails with a clear message.
    created = await client.post(
        f"/api/v1/projects/{pid}/jobs", json={"kind": "plan", "source_id": sid}
    )
    failed = await _job(client, pid, created.json()["id"])
    assert failed["status"] == "failed"
    assert "no transcript" in failed["error"]


async def test_plan_job_params_are_validated(chain_client: AsyncClient) -> None:
    pid = await _project(chain_client)
    for params in ({"vibe": "spooky"}, {"mode": "agents"}):
        response = await chain_client.post(
            f"/api/v1/projects/{pid}/jobs", json={"kind": "plan", "params": params}
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_params"


async def test_transcribe_job_without_source_fails(chain_client: AsyncClient) -> None:
    pid = await _project(chain_client)
    created = await chain_client.post(f"/api/v1/projects/{pid}/jobs", json={"kind": "transcribe"})
    job = await _job(chain_client, pid, created.json()["id"], limit_s=10)
    assert job["status"] == "failed"
    assert job["error"] == "A transcribe job needs a source_id"


async def test_resolved_plan_keeps_plain_urls(chain_client: AsyncClient, plan: dict) -> None:
    pid = await _project(chain_client)
    assert (await chain_client.put(f"/api/v1/projects/{pid}/plan", json=plan)).status_code == 200
    body = (await chain_client.get(f"/api/v1/projects/{pid}/plan/resolved")).json()
    assert body["plan"]["sources"][0]["src"] == "/media/talk.mp4"
    assert (await chain_client.get(f"/api/v1/projects/{pid}/plan/resolved")).headers["etag"]
