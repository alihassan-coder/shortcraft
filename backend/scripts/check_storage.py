"""Check the Cloudflare R2 setup from backend/.env. Run: uv run python -m scripts.check_storage

Steps: upload a tiny object with a presigned PUT (like the browser), HEAD it, read it with a
presigned GET, check bucket CORS for the editor origin, multipart upload of one part, delete
everything. Prints PASS/FAIL per step. Never prints keys or secrets.
"""

import asyncio
import sys
import uuid
from collections.abc import Awaitable, Callable

import httpx

from app.core.config import get_settings
from app.schemas.upload import CompletedPart
from app.services.storage import R2Storage

PAYLOAD = b"shortcraft storage check\n"
CONTENT_TYPE = "video/mp4"

results: list[bool] = []


async def step(name: str, fn: Callable[[], Awaitable[str | None]]) -> bool:
    try:
        note = await fn()
    except Exception as exc:  # report and keep going
        print(f"FAIL  {name}: {type(exc).__name__}: {str(exc)[:200]}")
        results.append(False)
        return False
    print(f"PASS  {name}" + (f" ({note})" if note else ""))
    results.append(True)
    return True


async def main() -> int:
    settings = get_settings()
    missing = settings.missing_r2_settings()
    if missing:
        print("FAIL  settings: missing in backend/.env: " + ", ".join(missing))
        return 1
    print(f"Bucket: {settings.r2_bucket}  (STORAGE_BACKEND={settings.storage_backend})")
    if settings.storage_backend != "r2":
        print("NOTE  STORAGE_BACKEND is not 'r2'; the API will still use local disk.")

    storage = R2Storage(settings)
    key = f"healthchecks/{uuid.uuid4()}.mp4"
    multipart_key = f"healthchecks/{uuid.uuid4()}-multipart.mp4"
    origin = settings.cors_origins[0] if settings.cors_origins else "http://localhost:3000"

    async with httpx.AsyncClient(timeout=30) as http:

        async def presigned_put() -> str:
            target = await storage.create_upload_target(key, CONTENT_TYPE, "")
            response = await http.put(target.url, content=PAYLOAD, headers=target.headers)
            response.raise_for_status()
            return f"HTTP {response.status_code}"

        async def head() -> str:
            info = await storage.head(key)
            assert info is not None, "object not found after upload"
            assert info.size == len(PAYLOAD), f"size {info.size} != {len(PAYLOAD)}"
            return f"{info.size} bytes"

        async def presigned_get() -> str:
            url, _ = await storage.download_url(
                key, filename="check.mp4", content_type=CONTENT_TYPE, local_url=""
            )
            response = await http.get(url)
            response.raise_for_status()
            assert response.content == PAYLOAD, "downloaded bytes differ"
            return "content matches"

        async def cors() -> str:
            target = await storage.create_upload_target(key, CONTENT_TYPE, "")
            response = await http.options(
                target.url,
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "PUT",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            allowed = response.headers.get("access-control-allow-origin")
            assert allowed in (origin, "*"), (
                f"origin {origin} not allowed (HTTP {response.status_code}); "
                "apply infra/r2-cors.json in the R2 dashboard"
            )
            return f"origin {origin} allowed"

        async def multipart() -> str:
            target = await storage.create_multipart_upload(
                multipart_key, CONTENT_TYPE, len(PAYLOAD), settings.multipart_part_size_bytes
            )
            try:
                part = target.parts[0]
                response = await http.put(part.url, content=PAYLOAD)
                response.raise_for_status()
                etag = response.headers.get("etag")
                assert etag, "no ETag header on the part response"
                await storage.complete_multipart_upload(
                    multipart_key,
                    target.upload_id,
                    [CompletedPart(part_number=1, etag=etag)],
                )
            except Exception:
                await storage.abort_multipart_upload(multipart_key, target.upload_id)
                raise
            assert await storage.exists(multipart_key), "object missing after complete"
            return "1 part"

        async def delete() -> str:
            await storage.delete(key)
            await storage.delete(multipart_key)
            assert not await storage.exists(key), "object still exists"
            return "test objects removed"

        if await step("presigned PUT upload", presigned_put):
            await step("HEAD object", head)
            await step("presigned GET download", presigned_get)
            await step("bucket CORS for the editor", cors)
        await step("multipart upload", multipart)
        await step("delete", delete)

    ok = all(results)
    print("\nALL PASS" if ok else "\nSOME CHECKS FAILED (see docs/SETUP.md, Troubleshooting)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
