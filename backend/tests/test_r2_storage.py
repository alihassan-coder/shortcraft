"""R2Storage against moto's in-process S3 mock (no network, no real keys)."""

from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import MiB
from app.core.errors import StorageError
from app.schemas.upload import CompletedPart
from app.services.storage import R2Storage, part_count, proxy_key, render_key, source_key
from tests.conftest import R2_ACCOUNT as ACCOUNT
from tests.conftest import R2_BUCKET as BUCKET
from tests.conftest import R2_ENDPOINT as ENDPOINT
from tests.conftest import make_settings


@pytest.fixture
def storage(mocked_s3: None, tmp_path: Path, r2_overrides: dict[str, Any]) -> R2Storage:
    r2 = R2Storage(make_settings(tmp_path, **r2_overrides))
    r2.client.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "auto"})
    return r2


def test_keys_and_part_count() -> None:
    import uuid

    pid, sid, jid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert source_key(pid, sid, "video/quicktime") == f"projects/{pid}/sources/{sid}/original.mov"
    assert proxy_key(pid, sid) == f"projects/{pid}/sources/{sid}/proxy-720p.mp4"
    assert render_key(pid, jid) == f"projects/{pid}/renders/{jid}.mp4"
    assert part_count(1, 10 * MiB) == 1
    assert part_count(10 * MiB, 10 * MiB) == 1
    assert part_count(10 * MiB + 1, 10 * MiB) == 2
    assert part_count(2 * 1024 * MiB, 10 * MiB) == 205


def test_missing_settings_fail_fast(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="R2_BUCKET") as info:
        R2Storage(make_settings(tmp_path, storage_backend="r2", r2_account_id=ACCOUNT))
    assert "test-secret" not in str(info.value)


async def test_presigned_single_put(storage: R2Storage) -> None:
    target = await storage.create_upload_target("a/b.mp4", "video/mp4", "ignored")
    assert target.mode == "single"
    assert target.headers == {"Content-Type": "video/mp4"}
    url = urlparse(target.url)
    assert f"{url.scheme}://{url.netloc}" == ENDPOINT
    assert url.path == f"/{BUCKET}/a/b.mp4"
    query = parse_qs(url.query)
    assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert "/auto/s3/" in query["X-Amz-Credential"][0]
    assert "content-type" in query["X-Amz-SignedHeaders"][0]
    assert query["X-Amz-Expires"] == [str(storage.upload_ttl)]


async def test_head_exists_get_url_delete(storage: R2Storage) -> None:
    key = "projects/p/sources/s/original.mp4"
    assert await storage.head(key) is None
    assert not await storage.exists(key)
    storage.client.put_object(Bucket=BUCKET, Key=key, Body=b"video", ContentType="video/mp4")

    info = await storage.head(key)
    assert info is not None
    assert info.size == 5
    assert info.content_type == "video/mp4"

    url, expires = await storage.download_url(
        key, filename="my talk.mp4", content_type="video/mp4", local_url="unused"
    )
    assert expires == 3600
    query = parse_qs(urlparse(url).query)
    assert query["response-content-type"] == ["video/mp4"]
    assert query["response-content-disposition"] == ['inline; filename="my_talk.mp4"']

    await storage.delete(key)
    assert not await storage.exists(key)


async def test_public_base_url(
    mocked_s3: None, tmp_path: Path, r2_overrides: dict[str, Any]
) -> None:
    settings = make_settings(tmp_path, **r2_overrides, r2_public_base_url="https://cdn.example/")
    url, expires = await R2Storage(settings).download_url(
        "projects/p/x.mp4", filename="x.mp4", content_type="video/mp4", local_url="unused"
    )
    assert (url, expires) == ("https://cdn.example/projects/p/x.mp4", None)


async def test_multipart_create_complete(storage: R2Storage) -> None:
    key = "projects/p/sources/s/original.mov"
    size = 6 * MiB
    target = await storage.create_multipart_upload(key, "video/quicktime", size, 5 * MiB)
    assert target.mode == "multipart"
    assert target.part_size == 5 * MiB
    assert [p.part_number for p in target.parts] == [1, 2]
    for part in target.parts:
        query = parse_qs(urlparse(part.url).query)
        assert query["uploadId"] == [target.upload_id]
        assert query["partNumber"] == [str(part.part_number)]
    dumped = target.model_dump()
    assert set(dumped) == {"mode", "uploadId", "partSize", "parts"}
    assert set(dumped["parts"][0]) == {"partNumber", "url"}

    # What the browser does with the part URLs, done through the client.
    data = b"a" * size
    etags = []
    for part in target.parts:
        start = (part.part_number - 1) * target.part_size
        response = storage.client.upload_part(
            Bucket=BUCKET,
            Key=key,
            UploadId=target.upload_id,
            PartNumber=part.part_number,
            Body=data[start : start + target.part_size],
        )
        etags.append(CompletedPart(part_number=part.part_number, etag=response["ETag"]))

    await storage.complete_multipart_upload(key, target.upload_id, list(reversed(etags)))
    info = await storage.head(key)
    assert info is not None
    assert info.size == size
    assert info.content_type == "video/quicktime"


async def test_multipart_abort(storage: R2Storage) -> None:
    key = "projects/p/sources/s/original.mp4"
    target = await storage.create_multipart_upload(key, "video/mp4", 6 * MiB, 5 * MiB)
    await storage.abort_multipart_upload(key, target.upload_id)
    await storage.abort_multipart_upload(key, target.upload_id)  # idempotent
    listed = storage.client.list_multipart_uploads(Bucket=BUCKET)
    assert listed.get("Uploads", []) == []


async def test_client_errors_become_storage_errors(storage: R2Storage) -> None:
    with pytest.raises(StorageError, match="NoSuchBucket"):
        await storage._call(storage.client.get_object, Bucket="does-not-exist", Key="k")


async def test_upload_from_and_download_to(storage: R2Storage, tmp_path: Path) -> None:
    src = tmp_path / "peaks.json"
    src.write_bytes(b'{"peaks": [0.5, 1.0]}')
    key = "projects/p/sources/s/peaks.json"
    await storage.upload_from(src, key, "application/json")
    head = await storage.head(key)
    assert head is not None and head.content_type == "application/json"

    dst = tmp_path / "copy.json"
    await storage.download_to(key, dst)
    assert dst.read_bytes() == src.read_bytes()

    with pytest.raises(StorageError):
        await storage.download_to("projects/p/missing.mp4", tmp_path / "missing.mp4")


async def test_local_upload_from_and_download_to(tmp_path: Path) -> None:
    from app.core.errors import NotFoundError
    from app.services.storage import LocalStorage

    local = LocalStorage(tmp_path / "root")
    src = tmp_path / "a.bin"
    src.write_bytes(b"abc")
    await local.upload_from(src, "projects/p/sources/s/sprite.jpg", "image/jpeg")
    assert (tmp_path / "root/projects/p/sources/s/sprite.jpg").read_bytes() == b"abc"
    await local.download_to("projects/p/sources/s/sprite.jpg", tmp_path / "b.bin")
    assert (tmp_path / "b.bin").read_bytes() == b"abc"
    with pytest.raises(NotFoundError):
        await local.download_to("projects/p/nope", tmp_path / "c.bin")
