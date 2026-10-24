"""Upload -> proxy job -> artifacts, through the HTTP API (LocalStorage + InProcessJobQueue)."""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import MiB
from app.main import create_app
from tests.conftest import _client_for, make_settings

pytestmark = [pytest.mark.integration, pytest.mark.ffmpeg]

TERMINAL = {"succeeded", "failed"}


@pytest.fixture
async def media_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    # A file database: the background job and the API use separate connections.
    settings = make_settings(
        tmp_path,
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        proxy_on_upload=True,
        max_upload_bytes=50 * MiB,
    )
    async for http in _client_for(create_app(settings)):
        yield http


async def _project(client: AsyncClient) -> str:
    response = await client.post("/api/v1/projects", json={"title": "Media"})
    assert response.status_code == 201
    return response.json()["id"]


async def _upload(client: AsyncClient, pid: str, path: Path, content_type: str) -> dict[str, Any]:
    data = path.read_bytes()
    created = await client.post(
        f"/api/v1/projects/{pid}/uploads",
        json={"filename": path.name, "content_type": content_type, "size_bytes": len(data)},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    put = await client.put(
        body["upload"]["url"].removeprefix("http://test"),
        content=data,
        headers=body["upload"]["headers"],
    )
    assert put.status_code == 200, put.text
    assert put.json()["status"] == "uploaded"
    # `complete` after the local PUT is idempotent and must not enqueue a second job.
    completed = await client.post(f"/api/v1/projects/{pid}/sources/{body['source']['id']}/complete")
    assert completed.status_code == 200
    return body["source"]


async def _wait_for_proxy(
    client: AsyncClient, pid: str, sid: str, timeout: float = 90
) -> dict[str, Any]:
    async with asyncio.timeout(timeout):
        while True:
            response = await client.get(f"/api/v1/projects/{pid}/sources/{sid}")
            assert response.status_code == 200
            source = response.json()
            job = source["proxy_job"]
            assert job is not None, "upload completion should enqueue a proxy job"
            if job["status"] in TERMINAL:
                return source
            await asyncio.sleep(0.1)


async def test_upload_makes_proxy_and_artifacts(media_client: AsyncClient, media_dir: Path) -> None:
    client = media_client
    pid = await _project(client)
    source = await _upload(client, pid, media_dir / "clip.mp4", "video/mp4")
    sid = source["id"]

    detail = await _wait_for_proxy(client, pid, sid)
    job = detail["proxy_job"]
    assert job["status"] == "succeeded", job["error"]
    assert job["kind"] == "proxy"
    assert job["source_id"] == sid
    assert job["progress"] == 100
    assert job["error"] is None
    assert job["started_at"] and job["finished_at"]
    assert job["result"]["proxy"]["width"] == 320
    assert job["result"]["loudness_lufs"] < 0
    assert set(job["result"]["artifacts"]) == {
        "proxy-720p.mp4",
        "audio-16k.wav",
        "sprite.jpg",
        "sprite.json",
        "peaks.json",
    }

    # GET /jobs/{id} shows the same lifecycle fields.
    fetched = (await client.get(f"/api/v1/projects/{pid}/jobs/{job['id']}")).json()
    assert fetched["status"] == "succeeded"
    assert fetched["progress"] == 100
    assert fetched["finished_at"] >= fetched["started_at"]

    assert detail["status"] == "ready"
    assert (detail["width"], detail["height"]) == (320, 568)
    assert abs(detail["duration_ms"] - 3000) <= 100
    assert detail["fps"] == 30
    assert detail["video_codec"] == "h264"
    assert detail["audio_codec"] == "aac"

    urls = detail["urls"]
    assert urls["original"]["url"].endswith(f"/sources/{sid}/content")
    for field in ("proxy", "audio", "sprite", "sprite_index", "peaks"):
        assert urls[field] is not None, field
        assert urls[field]["url"].startswith("http://test/api/v1/projects/")

    proxy = await client.get(urls["proxy"]["url"].removeprefix("http://test"))
    assert proxy.status_code == 200
    assert proxy.headers["content-type"] == "video/mp4"
    assert proxy.content[4:8] == b"ftyp"

    sprite = await client.get(urls["sprite"]["url"].removeprefix("http://test"))
    assert sprite.headers["content-type"] == "image/jpeg"

    index = (await client.get(urls["sprite_index"]["url"].removeprefix("http://test"))).json()
    assert index["count"] == len(index["frames"]) == 3

    peaks = json.loads((await client.get(urls["peaks"]["url"].removeprefix("http://test"))).text)
    assert peaks["peaks_per_second"] == 50
    assert abs(len(peaks["peaks"]) - 150) <= 5
    assert all(0 <= p <= 1 for p in peaks["peaks"])

    # The original still plays from its own route once the source is "ready".
    original = await client.get(urls["original"]["url"].removeprefix("http://test"))
    assert original.status_code == 200


async def test_rotated_mov_proxy_is_upright(media_client: AsyncClient, media_dir: Path) -> None:
    pid = await _project(media_client)
    source = await _upload(media_client, pid, media_dir / "rotated.mov", "video/quicktime")
    detail = await _wait_for_proxy(media_client, pid, source["id"])
    assert detail["proxy_job"]["status"] == "succeeded", detail["proxy_job"]["error"]
    assert (detail["width"], detail["height"]) == (568, 320)
    assert detail["proxy_job"]["result"]["proxy"]["width"] == 568


async def test_video_without_audio(media_client: AsyncClient, media_dir: Path) -> None:
    pid = await _project(media_client)
    source = await _upload(media_client, pid, media_dir / "silent.mp4", "video/mp4")
    detail = await _wait_for_proxy(media_client, pid, source["id"])
    assert detail["proxy_job"]["status"] == "succeeded", detail["proxy_job"]["error"]
    assert detail["audio_codec"] is None
    assert detail["urls"]["proxy"] is not None
    assert detail["urls"]["audio"] is None
    assert detail["urls"]["peaks"] is None


async def test_corrupt_upload_fails_with_message(media_client: AsyncClient, media_dir: Path) -> None:
    pid = await _project(media_client)
    source = await _upload(media_client, pid, media_dir / "corrupt.mp4", "video/mp4")
    detail = await _wait_for_proxy(media_client, pid, source["id"])
    job = detail["proxy_job"]
    assert job["status"] == "failed"
    assert job["error"].startswith("ffprobe failed")
    assert job["finished_at"] is not None
    assert job["progress"] < 100
    assert detail["status"] == "failed"
    assert detail["urls"]["proxy"] is None
    # The original is kept and still downloadable.
    assert detail["urls"]["original"] is not None

    missing = await media_client.get(
        f"/api/v1/projects/{pid}/sources/{source['id']}/files/proxy-720p.mp4"
    )
    assert missing.status_code == 404
    unknown = await media_client.get(f"/api/v1/projects/{pid}/sources/{source['id']}/files/x.txt")
    assert unknown.status_code == 404


async def test_manual_proxy_job_without_source_fails(media_client: AsyncClient) -> None:
    pid = await _project(media_client)
    created = await media_client.post(f"/api/v1/projects/{pid}/jobs", json={"kind": "proxy"})
    assert created.status_code == 202
    job_id = created.json()["id"]
    async with asyncio.timeout(10):
        while (job := (await media_client.get(f"/api/v1/projects/{pid}/jobs/{job_id}")).json())[
            "status"
        ] not in TERMINAL:
            await asyncio.sleep(0.05)
    assert job["status"] == "failed"
    assert job["error"] == "A proxy job needs a source_id"


async def test_manual_proxy_job_for_unknown_source(media_client: AsyncClient) -> None:
    pid = await _project(media_client)
    response = await media_client.post(
        f"/api/v1/projects/{pid}/jobs",
        json={"kind": "proxy", "source_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code == 404


async def test_source_detail_before_upload(client: AsyncClient, project_id: str) -> None:
    created = await client.post(
        f"/api/v1/projects/{project_id}/uploads",
        json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10},
    )
    sid = created.json()["source"]["id"]
    detail = (await client.get(f"/api/v1/projects/{project_id}/sources/{sid}")).json()
    assert detail["status"] == "pending"
    assert detail["urls"]["original"] is None
    assert detail["proxy_job"] is None
