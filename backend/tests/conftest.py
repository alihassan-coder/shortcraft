import contextlib
import copy
import shutil
import subprocess
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from moto import mock_aws

from app.core.config import MiB, Settings
from app.db.base import Base
from app.main import create_app

VALID_PLAN: dict[str, Any] = {
    "version": 2,
    "id": "plan_1",
    "title": "My first short",
    "vibe": "energetic",
    "canvas": {
        "aspect": "9:16",
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "background": {"type": "blur", "color": "#000000"},
    },
    "sources": [
        {
            "id": "src_1",
            "src": "/media/talk.mp4",
            "width": 1080,
            "height": 1920,
            "durationMs": 30000,
            "words": [
                {"id": "w1", "text": "Hello", "startMs": 0, "endMs": 400},
                {"id": "w2", "text": "um", "startMs": 400, "endMs": 700, "filler": True},
            ],
        }
    ],
    "clips": [
        {
            "id": "clip_1",
            "sourceId": "src_1",
            "inMs": 0,
            "outMs": 30000,
            "speed": 1,
            "volume": 1,
            "muted": False,
            "frame": {
                "fit": "fill",
                "scale": 1,
                "x": 0,
                "y": 0,
                "rotate": 0,
                "flipH": False,
                "flipV": False,
            },
            "crop": {"left": 0, "top": 0, "right": 0, "bottom": 0},
            "color": {
                "preset": "none",
                "brightness": 0,
                "contrast": 0,
                "saturation": 0,
                "temperature": 0,
            },
        }
    ],
    "cuts": {
        "items": [
            {"id": "cut_1", "sourceId": "src_1", "startMs": 400, "endMs": 700, "reason": "filler"}
        ],
        "silence": True,
        "filler": True,
        "retake": False,
        "restored": [],
    },
    "captions": {
        "enabled": True,
        "presetId": "bold-pop",
        "size": 72,
        "positionY": 0.7,
        "wordsPerLine": 2,
        "showEmojis": True,
        "highlights": ["w1"],
        "emojis": {"w1": "👋"},
        "edits": {},
    },
    "zooms": {
        "enabled": True,
        "items": [
            {
                "id": "z1",
                "sourceId": "src_1",
                "startMs": 0,
                "endMs": 1000,
                "scale": 1.2,
                "style": "punch",
                "focusX": 0.5,
                "focusY": 0.4,
            }
        ],
    },
    "overlays": {
        "texts": [],
        "images": [],
        "progressBar": {"enabled": False, "position": "bottom", "color": "#FF5B1F"},
    },
    "music": {
        "trackId": None,
        "volume": 0.3,
        "ducking": True,
        "duckTo": 0.15,
        "fadeInMs": 500,
        "fadeOutMs": 800,
    },
    "hook": {"enabled": True, "text": "Watch this", "options": ["Watch this"], "durationMs": 2000},
    "voice": {"enhance": False},
}


@pytest.fixture
def plan() -> dict[str, Any]:
    return copy.deepcopy(VALID_PLAN)


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    """Test settings: never read backend/.env, always SQLite in memory + local disk, no auth."""
    values: dict[str, Any] = {
        "env": "test",
        "database_url": "sqlite+aiosqlite:///:memory:",
        "database_url_migrations": None,
        "storage_backend": "local",
        "local_storage_dir": tmp_path / "uploads",
        "public_base_url": "http://test",
        "max_upload_bytes": 1024 * 1024,
        "auth_required": False,
        "supabase_url": None,
        "supabase_jwt_secret": None,
        "supabase_jwks_url": None,
        "r2_public_base_url": None,
        "job_queue_backend": "inprocess",
        "redis_url": None,
        "proxy_on_upload": False,
        "transcribe_on_upload": False,
        "auto_plan": False,
        "transcription_provider": "fake",
        "deepgram_api_key": None,
        "work_dir": tmp_path / "work",
        # AI: never a real key or tracing in tests; chained plans stay "basic" unless asked.
        "openai_api_key": None,
        "agent_model_fallback": None,
        "ai_plan_enabled": False,
        "langsmith_tracing": False,
        "langsmith_api_key": None,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


async def _client_for(app: Any) -> AsyncIterator[AsyncClient]:
    async with app.router.lifespan_context(app):
        async with app.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            yield http


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    async for http in _client_for(create_app(settings)):
        yield http


@pytest.fixture
async def project_id(client: AsyncClient) -> str:
    response = await client.post("/api/v1/projects", json={"title": "Test project"})
    assert response.status_code == 201
    return response.json()["id"]


# --- R2 via moto ---------------------------------------------------------------------------

R2_ACCOUNT = "testacct"
R2_ENDPOINT = f"https://{R2_ACCOUNT}.r2.cloudflarestorage.com"
R2_BUCKET = "shortcraft-test"


@pytest.fixture
def r2_overrides() -> dict[str, Any]:
    """Settings for R2Storage with fake keys; small sizes so multipart tests stay fast."""
    return {
        "storage_backend": "r2",
        "r2_account_id": R2_ACCOUNT,
        "r2_bucket": R2_BUCKET,
        "r2_access_key_id": "test-access-key",
        "r2_secret_access_key": "test-secret-key",
        "multipart_threshold_bytes": 5 * MiB,
        "multipart_part_size_bytes": 5 * MiB,
        "max_upload_bytes": 20 * MiB,
    }


@pytest.fixture
def mocked_s3(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """In-process S3 mock (moto) that also answers the R2-style endpoint. No network."""
    monkeypatch.setenv("MOTO_S3_CUSTOM_ENDPOINTS", R2_ENDPOINT)
    with mock_aws():
        yield


# --- markers + ffmpeg fixtures ---------------------------------------------------------------

FFMPEG_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Tests that use the HTTP client are `integration`, the rest `unit` (unless marked).
    `ffmpeg` tests are skipped when the binaries are not installed."""
    skip_ffmpeg = pytest.mark.skip(reason="ffmpeg/ffprobe not installed")
    for item in items:
        names = {mark.name for mark in item.iter_markers()}
        if not names & {"unit", "integration"}:
            fixtures = getattr(item, "fixturenames", ())
            uses_http = "client" in fixtures or "media_client" in fixtures
            item.add_marker(pytest.mark.integration if uses_http else pytest.mark.unit)
        if "ffmpeg" in names and not FFMPEG_AVAILABLE:
            item.add_marker(skip_ffmpeg)


def _ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args],
        check=True,
        capture_output=True,
        timeout=120,
    )


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Tiny clips made with ffmpeg once per session (3 s, 320x568 portrait, 30 fps, 440 Hz)."""
    if not FFMPEG_AVAILABLE:
        pytest.skip("ffmpeg/ffprobe not installed")
    root = tmp_path_factory.mktemp("media")
    lavfi = [
        "-f", "lavfi", "-i", "testsrc=size=320x568:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "3",
    ]  # fmt: skip
    _ffmpeg(*lavfi, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(root / "clip.mp4"))
    # Same clip in a .mov with phone-style rotation metadata (display matrix, 90 degrees).
    _ffmpeg("-display_rotation", "90", "-i", str(root / "clip.mp4"), "-c", "copy",
            str(root / "rotated.mov"))  # fmt: skip
    # Bigger than 720p, 1 s: the proxy must scale it down.
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30", "-t", "1",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(root / "big.mp4"))  # fmt: skip
    # Video only, no audio track.
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-t", "2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / "silent.mp4"))  # fmt: skip
    (root / "corrupt.mp4").write_bytes(b"ftypmp42" + b"not a video" * 200)
    # HEVC in .mov (what iPhones record) when this ffmpeg build has libx265.
    with contextlib.suppress(subprocess.CalledProcessError):
        _ffmpeg(*lavfi, "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p",
                "-x265-params", "log-level=error", "-c:a", "aac",
                str(root / "hevc.mov"))  # fmt: skip
    return root


@pytest.fixture(scope="session")
def gap_clip(media_dir: Path) -> Path:
    """6 s portrait clip whose audio is 2 s tone, 1 s digital silence, 3 s tone."""
    path = media_dir / "gap.mp4"
    if not path.exists():
        _ffmpeg(
            "-f", "lavfi", "-i", "testsrc=size=320x568:rate=30:duration=6",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
            "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
            "-filter_complex", "[2:a]atrim=duration=1[gap];[1:a][gap][3:a]concat=n=3:v=0:a=1[a]",
            "-map", "0:v", "-map", "[a]", "-t", "6",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
            str(path),
        )  # fmt: skip
    return path
