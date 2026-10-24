"""Upload endpoints with STORAGE_BACKEND=r2, backed by moto (no network)."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient

from app.core.config import MiB
from app.main import create_app
from app.services.storage import R2Storage
from tests.conftest import R2_BUCKET as BUCKET
from tests.conftest import R2_ENDPOINT as ENDPOINT
from tests.conftest import _client_for, make_settings


@dataclass
class R2App:
    http: AsyncClient
    storage: R2Storage
    project_id: str


@pytest.fixture
async def r2(mocked_s3: None, tmp_path: Path, r2_overrides: dict[str, Any]) -> AsyncIterator[R2App]:
    app = create_app(make_settings(tmp_path, **r2_overrides))
    async for http in _client_for(app):
        storage = app.state.storage
        assert isinstance(storage, R2Storage)
        storage.client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "auto"}
        )
        project = await http.post("/api/v1/projects", json={"title": "R2 project"})
        yield R2App(http, storage, project.json()["id"])


def _key_from_url(url: str) -> str:
    return urlparse(url).path.removeprefix(f"/{BUCKET}/")


async def test_small_file_gets_single_presigned_put(r2: R2App) -> None:
    r2_client, r2_project = r2.http, r2.project_id
    created = await r2_client.post(
        f"/api/v1/projects/{r2_project}/uploads",
        json={"filename": "clip.webm", "content_type": "video/webm", "size_bytes": 1000},
    )
    assert created.status_code == 201
    body = created.json()
    upload, source = body["upload"], body["source"]
    assert upload["mode"] == "single"
    assert upload["method"] == "PUT"
    assert upload["url"].startswith(f"{ENDPOINT}/{BUCKET}/projects/{r2_project}/sources/")
    assert upload["headers"] == {"Content-Type": "video/webm"}
    key = _key_from_url(upload["url"])
    assert key == f"projects/{r2_project}/sources/{source['id']}/original.webm"

    base = f"/api/v1/projects/{r2_project}/sources/{source['id']}"
    not_yet = await r2_client.post(f"{base}/complete")
    assert not_yet.json()["error"]["code"] == "upload_incomplete"

    r2.storage.client.put_object(Bucket=BUCKET, Key=key, Body=b"v" * 900, ContentType="video/webm")
    completed = await r2_client.post(f"{base}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "uploaded"
    assert completed.json()["size_bytes"] == 900  # real size from HEAD

    url = await r2_client.get(f"{base}/url")
    assert url.status_code == 200
    assert url.json()["expires_in"] == 3600
    assert "X-Amz-Signature=" in url.json()["url"]

    # Local-only routes are not available with R2.
    assert (await r2_client.get(f"{base}/content")).status_code == 404


async def test_large_file_multipart_flow(r2: R2App) -> None:
    r2_client, r2_project = r2.http, r2.project_id
    size = 11 * MiB
    created = await r2_client.post(
        f"/api/v1/projects/{r2_project}/uploads",
        json={"filename": "phone.MOV", "content_type": "video/quicktime", "size_bytes": size},
    )
    assert created.status_code == 201
    body = created.json()
    upload, source = body["upload"], body["source"]
    assert upload["mode"] == "multipart"
    assert upload["partSize"] == 5 * MiB
    assert [p["partNumber"] for p in upload["parts"]] == [1, 2, 3]
    key = _key_from_url(upload["parts"][0]["url"])
    assert key.endswith(f"/sources/{source['id']}/original.mov")

    client = r2.storage.client
    data = b"m" * size
    parts = []
    for part in upload["parts"]:
        start = (part["partNumber"] - 1) * upload["partSize"]
        response = client.upload_part(
            Bucket=BUCKET,
            Key=key,
            UploadId=upload["uploadId"],
            PartNumber=part["partNumber"],
            Body=data[start : start + upload["partSize"]],
        )
        parts.append({"partNumber": part["partNumber"], "etag": response["ETag"]})

    base = f"/api/v1/projects/{r2_project}/sources/{source['id']}"
    missing_parts = await r2_client.post(f"{base}/complete")
    assert missing_parts.status_code == 400
    assert missing_parts.json()["error"]["code"] == "parts_required"

    completed = await r2_client.post(f"{base}/complete", json={"parts": parts})
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "uploaded"
    assert completed.json()["size_bytes"] == size

    again = await r2_client.post(f"{base}/complete", json={"parts": parts})
    assert again.status_code == 200  # idempotent

    # Abort after completion is refused; the object stays.
    assert (await r2_client.post(f"{base}/abort")).status_code == 409
    assert await r2.storage.exists(key)


async def test_abort_multipart(r2: R2App) -> None:
    r2_client, r2_project = r2.http, r2.project_id
    created = await r2_client.post(
        f"/api/v1/projects/{r2_project}/uploads",
        json={"filename": "big.mp4", "content_type": "video/mp4", "size_bytes": 6 * MiB},
    )
    source_id = created.json()["source"]["id"]
    base = f"/api/v1/projects/{r2_project}/sources/{source_id}"
    aborted = await r2_client.post(f"{base}/abort")
    assert aborted.status_code == 200
    assert aborted.json()["status"] == "aborted"
    assert (await r2_client.post(f"{base}/abort")).status_code == 200
    completed = await r2_client.post(f"{base}/complete", json={"parts": []})
    assert completed.status_code == 409
    assert (await r2_client.get(f"{base}/url")).status_code == 404


async def test_completed_object_larger_than_limit_is_removed(r2: R2App) -> None:
    r2_client, r2_project = r2.http, r2.project_id
    created = await r2_client.post(
        f"/api/v1/projects/{r2_project}/uploads",
        json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10},
    )
    key = _key_from_url(created.json()["upload"]["url"])
    source_id = created.json()["source"]["id"]
    storage = r2.storage
    storage.client.put_object(Bucket=BUCKET, Key=key, Body=b"x" * (21 * MiB))
    response = await r2_client.post(f"/api/v1/projects/{r2_project}/sources/{source_id}/complete")
    assert response.status_code == 413
    assert not await storage.exists(key)
