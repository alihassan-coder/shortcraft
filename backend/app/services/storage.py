"""Object storage behind a small interface. LocalStorage now; R2 (S3-compatible) later."""

import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol

import anyio

from app.core.config import Settings
from app.core.errors import NotFoundError, PayloadTooLargeError
from app.schemas.upload import UploadTarget


class StorageAdapter(Protocol):
    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> UploadTarget:
        """Return where the client should PUT the bytes for `key`.

        `upload_url` is the API's own receive endpoint; adapters that upload directly to a
        bucket (R2) ignore it and return a presigned URL instead.
        """
        ...

    async def exists(self, key: str) -> bool: ...

    async def delete(self, key: str) -> None: ...


def safe_filename(name: str) -> str:
    stem = Path(name.replace("\\", "/")).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return cleaned[:120] or "upload"


class LocalStorage:
    """Stores files on local disk; the API itself receives and serves the bytes."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path_for(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise NotFoundError("Invalid storage key")
        return path

    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> UploadTarget:
        return UploadTarget(url=upload_url, headers={"Content-Type": content_type})

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

    async def exists(self, key: str) -> bool:
        return await anyio.Path(self.path_for(key)).is_file()

    async def delete(self, key: str) -> None:
        await anyio.Path(self.path_for(key)).unlink(missing_ok=True)


class R2Storage:
    """Cloudflare R2 via the S3 API. Not implemented yet.

    TODO: add an S3 client (aioboto3), endpoint https://<r2_account_id>.r2.cloudflarestorage.com,
    return presigned PUT URLs from create_upload_target, implement exists (HEAD) and delete.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def create_upload_target(
        self, key: str, content_type: str, upload_url: str
    ) -> UploadTarget:
        raise NotImplementedError("R2 storage is not implemented yet")

    async def exists(self, key: str) -> bool:
        raise NotImplementedError("R2 storage is not implemented yet")

    async def delete(self, key: str) -> None:
        raise NotImplementedError("R2 storage is not implemented yet")


def build_storage(settings: Settings) -> StorageAdapter:
    if settings.storage_backend == "r2":
        return R2Storage(settings)
    return LocalStorage(settings.local_storage_dir)
