import copy
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
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


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        env="test",
        database_url="sqlite+aiosqlite:///:memory:",
        local_storage_dir=tmp_path / "uploads",
        public_base_url="http://test",
        max_upload_bytes=1024 * 1024,
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with app.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            yield http


@pytest.fixture
async def project_id(client: AsyncClient) -> str:
    response = await client.post("/api/v1/projects", json={"title": "Test project"})
    assert response.status_code == 201
    return response.json()["id"]
