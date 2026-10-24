"""Object storage behind a small interface: LocalStorage (dev/tests) and R2Storage (S3 API).

Key layout (see the helpers below):
    projects/{project_id}/sources/{source_id}/original.{ext}
    projects/{project_id}/sources/{source_id}/proxy-720p.mp4   (+ audio-16k.wav, sprite.jpg,
                                                               sprite.json, peaks.json,
                                                               transcript.json)
    projects/{project_id}/renders/{job_id}.mp4
"""

import functools
import logging
import math
import re
import shutil
import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import quote

import anyio
import anyio.to_thread

from app.core.config import ALLOWED_VIDEO_TYPES, Settings
from app.core.errors import AppError, NotFoundError, PayloadTooLargeError, StorageError
from app.schemas.upload import (
    CompletedPart,
    MultipartUploadTarget,
    SingleUploadTarget,
    UploadPart,
)

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger(__name__)

MAX_PARTS = 10_000  # S3/R2 limit
_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound", "NoSuchUpload"})


# --- keys --------------------------------------------------------------------------------


def source_key(project_id: uuid.UUID, source_id: uuid.UUID, content_type: str) -> str:
    ext = ALLOWED_VIDEO_TYPES.get(content_type, "bin")
    return f"projects/{project_id}/sources/{source_id}/original.{ext}"


# Files the proxy job writes next to the original: name -> content type.
SOURCE_ARTIFACTS: dict[str, str] = {
    "proxy-720p.mp4": "video/mp4",
    "audio-16k.wav": "audio/wav",
    "sprite.jpg": "image/jpeg",
    "sprite.json": "application/json",
    "peaks.json": "application/json",
    # Written by the transcribe job.
    "transcript.json": "application/json",
}


def source_artifact_key(project_id: uuid.UUID, source_id: uuid.UUID, name: str) -> str:
    if name not in SOURCE_ARTIFACTS:
        raise ValueError(f"Unknown source artifact {name!r}")
    return f"projects/{project_id}/sources/{source_id}/{name}"


def proxy_key(project_id: uuid.UUID, source_id: uuid.UUID) -> str:
    return source_artifact_key(project_id, source_id, "proxy-720p.mp4")


def render_key(project_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"projects/{project_id}/renders/{job_id}.mp4"


def safe_filename(name: str) -> str:
    stem = Path(name.replace("\\", "/")).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return cleaned[:120] or "upload"


def part_count(size_bytes: int, part_size: int) -> int:
    return max(1, math.ceil(size_bytes / part_size))


@dataclass(frozen=True, slots=True)
class ObjectInfo:
    size: int
    content_type: str | None = None
    etag: str | None = None


# --- interface ---------------------------------------------------------------------------


class StorageAdapter(Protocol):
    # True if create_multipart_upload is available (R2). LocalStorage always uses one PUT.
    supports_multipart: bool

    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> SingleUploadTarget:
        """Return where the client should PUT the whole file for `key`.

        `upload_url` is the API's own receive endpoint; adapters that upload directly to a
        bucket (R2) ignore it and return a presigned URL instead.
        """
        ...

    async def create_multipart_upload(
        self, key: str, content_type: str, size_bytes: int, part_size: int
    ) -> MultipartUploadTarget: ...

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: Sequence[CompletedPart]
    ) -> None: ...

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None: ...

    async def download_url(
        self, key: str, *, filename: str, content_type: str, local_url: str
    ) -> tuple[str, int | None]:
        """Return (url, expires_in_seconds | None) to read `key`.

        `local_url` is the API's own content route, used by LocalStorage.
        """
        ...

    async def head(self, key: str) -> ObjectInfo | None: ...

    async def exists(self, key: str) -> bool: ...

    async def delete(self, key: str) -> None: ...

    async def download_to(self, key: str, path: Path) -> None:
        """Copy the object at `key` to the local file `path` (streamed, not held in memory)."""
        ...

    async def upload_from(self, path: Path, key: str, content_type: str) -> None:
        """Store the local file `path` at `key`."""
        ...


# --- local disk --------------------------------------------------------------------------


class LocalStorage:
    """Stores files on local disk; the API itself receives and serves the bytes."""

    supports_multipart = False

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path_for(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise NotFoundError("Invalid storage key")
        return path

    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> SingleUploadTarget:
        return SingleUploadTarget(url=upload_url, headers={"Content-Type": content_type})

    async def create_multipart_upload(
        self, key: str, content_type: str, size_bytes: int, part_size: int
    ) -> MultipartUploadTarget:
        raise AppError("Local storage does not support multipart uploads", code="unsupported")

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: Sequence[CompletedPart]
    ) -> None:
        raise AppError("Local storage does not support multipart uploads", code="unsupported")

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        return None

    async def download_url(
        self, key: str, *, filename: str, content_type: str, local_url: str
    ) -> tuple[str, int | None]:
        return local_url, None

    async def write(self, key: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
        path = self.path_for(key)
        await anyio.Path(path.parent).mkdir(parents=True, exist_ok=True)
        tmp = anyio.Path(path.with_name(path.name + ".part"))
        written = 0
        try:
            async with await anyio.open_file(tmp, "wb") as fh:
                async for chunk in chunks:
                    written += len(chunk)
                    if written > max_bytes:
                        raise PayloadTooLargeError("Upload is larger than the declared size")
                    await fh.write(chunk)
            await tmp.replace(path)
        finally:
            await tmp.unlink(missing_ok=True)
        return written

    async def head(self, key: str) -> ObjectInfo | None:
        path = anyio.Path(self.path_for(key))
        if not await path.is_file():
            return None
        return ObjectInfo(size=(await path.stat()).st_size)

    async def exists(self, key: str) -> bool:
        return await self.head(key) is not None

    async def delete(self, key: str) -> None:
        await anyio.Path(self.path_for(key)).unlink(missing_ok=True)

    async def download_to(self, key: str, path: Path) -> None:
        src = self.path_for(key)
        if not await anyio.Path(src).is_file():
            raise NotFoundError("Stored file not found")
        await anyio.to_thread.run_sync(shutil.copyfile, src, path)

    async def upload_from(self, path: Path, key: str, content_type: str) -> None:
        dst = self.path_for(key)
        await anyio.Path(dst.parent).mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(dst.name + ".part")
        await anyio.to_thread.run_sync(shutil.copyfile, path, tmp)
        await anyio.Path(tmp).replace(dst)


# --- Cloudflare R2 (S3 API) --------------------------------------------------------------


def _error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None) or {}
    return str(response.get("Error", {}).get("Code", ""))


class R2Storage:
    """Cloudflare R2 through its S3-compatible API (boto3, SigV4, region "auto").

    Browsers upload and download directly with presigned URLs; the API never proxies bytes.
    Blocking boto3 network calls run in a worker thread. Presigning is local (no network).
    """

    supports_multipart = True

    def __init__(self, settings: Settings, client: S3Client | None = None) -> None:
        missing = settings.missing_r2_settings()
        if missing and client is None:
            raise RuntimeError(
                "STORAGE_BACKEND=r2 but these settings are missing: " + ", ".join(missing)
            )
        assert settings.r2_bucket
        self.bucket = settings.r2_bucket
        self.upload_ttl = settings.upload_url_ttl_seconds
        self.download_ttl = settings.download_url_ttl_seconds
        self.public_base_url = (settings.r2_public_base_url or "").rstrip("/") or None
        self.client: S3Client = client or self._build_client(settings)

    @staticmethod
    def _build_client(settings: Settings) -> S3Client:
        import boto3
        from botocore.config import Config

        assert settings.r2_secret_access_key is not None
        return boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key.get_secret_value(),
            region_name="auto",
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
                # R2 rejects the newer default CRC checksums on presigned/multipart requests.
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    async def _call[T](self, fn: Callable[..., T], /, **kwargs: Any) -> T:
        try:
            return await anyio.to_thread.run_sync(functools.partial(fn, **kwargs))
        except Exception as exc:
            if hasattr(exc, "response"):
                code = _error_code(exc) or "unknown error"
                if code not in _NOT_FOUND_CODES:
                    logger.warning("R2 request failed: %s", code)
                raise StorageError(f"Storage request failed ({code})") from exc
            raise

    def _presign(self, method: str, params: dict[str, Any], expires: int) -> str:
        return self.client.generate_presigned_url(
            method, Params={"Bucket": self.bucket, **params}, ExpiresIn=expires
        )

    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> SingleUploadTarget:
        url = self._presign(
            "put_object", {"Key": key, "ContentType": content_type}, self.upload_ttl
        )
        return SingleUploadTarget(url=url, headers={"Content-Type": content_type})

    async def create_multipart_upload(
        self, key: str, content_type: str, size_bytes: int, part_size: int
    ) -> MultipartUploadTarget:
        count = part_count(size_bytes, part_size)
        if count > MAX_PARTS:
            raise PayloadTooLargeError("File needs more than 10000 parts; raise the part size")
        created = await self._call(
            self.client.create_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            ContentType=content_type,
        )
        upload_id = created["UploadId"]
        parts = [
            UploadPart(
                part_number=n,
                url=self._presign(
                    "upload_part",
                    {"Key": key, "UploadId": upload_id, "PartNumber": n},
                    self.upload_ttl,
                ),
            )
            for n in range(1, count + 1)
        ]
        return MultipartUploadTarget(upload_id=upload_id, part_size=part_size, parts=parts)

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: Sequence[CompletedPart]
    ) -> None:
        ordered = sorted(parts, key=lambda p: p.part_number)
        await self._call(
            self.client.complete_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={
                "Parts": [
                    # Browsers expose the ETag with quotes; S3 accepts either, normalize anyway.
                    {"PartNumber": p.part_number, "ETag": f'"{p.etag.strip().strip(chr(34))}"'}
                    for p in ordered
                ]
            },
        )

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        try:
            await self._call(
                self.client.abort_multipart_upload,
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
            )
        except StorageError as exc:
            if _error_code(exc.__cause__ or exc) not in _NOT_FOUND_CODES:
                raise

    async def download_url(
        self, key: str, *, filename: str, content_type: str, local_url: str
    ) -> tuple[str, int | None]:
        if self.public_base_url:
            return f"{self.public_base_url}/{quote(key)}", None
        disposition = f'inline; filename="{safe_filename(filename)}"'
        url = self._presign(
            "get_object",
            {
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseContentDisposition": disposition,
            },
            self.download_ttl,
        )
        return url, self.download_ttl

    async def head(self, key: str) -> ObjectInfo | None:
        try:
            meta = await self._call(self.client.head_object, Bucket=self.bucket, Key=key)
        except StorageError as exc:
            if _error_code(exc.__cause__ or exc) in _NOT_FOUND_CODES:
                return None
            raise
        return ObjectInfo(
            size=int(meta["ContentLength"]),
            content_type=meta.get("ContentType"),
            etag=meta.get("ETag"),
        )

    async def exists(self, key: str) -> bool:
        return await self.head(key) is not None

    async def delete(self, key: str) -> None:
        await self._call(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def download_to(self, key: str, path: Path) -> None:
        # boto3's managed transfer: ranged, parallel GETs straight to disk.
        await self._call(self.client.download_file, Bucket=self.bucket, Key=key, Filename=str(path))

    async def upload_from(self, path: Path, key: str, content_type: str) -> None:
        await self._call(
            self.client.upload_file,
            Filename=str(path),
            Bucket=self.bucket,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )


def build_storage(settings: Settings) -> StorageAdapter:
    if settings.storage_backend == "r2":
        return R2Storage(settings)
    return LocalStorage(settings.local_storage_dir)
