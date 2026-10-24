import copy
from collections.abc import Callable
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import VALID_PLAN


def plan_url(project_id: str) -> str:
    return f"/api/v1/projects/{project_id}/plan"


async def test_plan_not_found_before_first_put(client: AsyncClient, project_id: str) -> None:
    response = await client.get(plan_url(project_id))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "plan_not_found"


async def test_put_and_get_valid_plan(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    created = await client.put(plan_url(project_id), json=plan)
    assert created.status_code == 200
    assert created.headers["etag"] == '"1"'
    assert created.json()["revision"] == 1

    fetched = await client.get(plan_url(project_id))
    assert fetched.status_code == 200
    assert fetched.headers["etag"] == '"1"'
    # Round-trips in the exact camelCase wire format the frontend uses.
    assert fetched.json()["plan"] == plan


async def test_put_rejects_invalid_plan(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    plan["clips"] = []
    plan["captions"]["wordsPerLine"] = 4
    response = await client.put(plan_url(project_id), json=plan)
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    # loc is ["body", <version tag>, ...field path]
    assert {d["loc"][1] for d in body["details"]} == {2}
    bad_fields = {tuple(d["loc"][2:]) for d in body["details"]}
    assert ("clips",) in bad_fields
    assert ("captions", "wordsPerLine") in bad_fields
    assert (await client.get(plan_url(project_id))).status_code == 404


async def test_put_rejects_unknown_version(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    plan["version"] = 1
    response = await client.put(plan_url(project_id), json=plan)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["type"] == "union_tag_invalid"


async def test_put_rejects_wrong_types(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    plan["clips"][0]["muted"] = "false"  # Zod rejects strings for booleans; so do we
    response = await client.put(plan_url(project_id), json=plan)
    assert response.status_code == 422


async def test_optimistic_concurrency(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    url = plan_url(project_id)
    await client.put(url, json=plan)

    plan["title"] = "Edited"
    missing = await client.put(url, json=plan)
    assert missing.status_code == 428

    updated = await client.put(url, json=plan, headers={"If-Match": '"1"'})
    assert updated.status_code == 200
    assert updated.headers["etag"] == '"2"'
    assert updated.json()["plan"]["title"] == "Edited"

    stale = await client.put(url, json=plan, headers={"If-Match": '"1"'})
    assert stale.status_code == 412
    assert stale.json()["error"]["code"] == "revision_mismatch"


async def test_plan_for_missing_project(client: AsyncClient, plan: dict[str, Any]) -> None:
    url = plan_url("00000000-0000-0000-0000-000000000000")
    response = await client.put(url, json=plan)
    assert response.status_code == 404


# --- v3 (tracks of items) --------------------------------------------------------------------

ANIMATION = {
    "in": {"type": "pop", "durationMs": 220},
    "out": {"type": "slide-up", "durationMs": 200},
    "loop": "none",
}
TRANSFORM = {"x": 0.5, "y": 0.3, "scale": 1, "rotation": 0, "opacity": 1}


def v3_plan() -> dict[str, Any]:
    plan = copy.deepcopy(VALID_PLAN)
    del plan["overlays"]
    plan["version"] = 3
    for clip in plan["clips"]:
        clip["frame"]["opacity"] = 1
        clip["animation"] = {
            "in": {"type": "fade", "durationMs": 300},
            "out": {"type": "none", "durationMs": 0},
        }
    plan["clips"][0]["transition"] = {"type": "whip", "durationMs": 400}
    plan["clips"][0]["audioDetached"] = False
    plan["progressBar"] = {"enabled": True, "position": "top", "color": "#FF5B1F", "thickness": 14}
    plan["tracks"] = [
        {
            "id": "track_text",
            "kind": "text",
            "name": "Text",
            "locked": False,
            "hidden": False,
            "muted": False,
            "items": [
                {
                    "id": "t1",
                    "kind": "text",
                    "startMs": 0,
                    "endMs": 2000,
                    "text": "Hello",
                    "presetId": "bold-pop",
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                    "style": {
                        "fontFamily": "Impact",
                        "fontWeight": 900,
                        "italic": False,
                        "size": 90,
                        "letterSpacing": 0,
                        "lineHeight": 1.1,
                        "align": "center",
                        "case": "upper",
                        "color": "#ffffff",
                        "gradient": {"from": "#ffffff", "to": "#e9d5ff", "angle": 90},
                        "stroke": {"color": "#000000", "width": 8},
                        "shadow": {"color": "#00000099", "blur": 8, "x": 0, "y": 2},
                        "background": {
                            "color": "#000000",
                            "opacity": 0.65,
                            "padding": 16,
                            "radius": 16,
                        },
                    },
                },
                {
                    "id": "t2",
                    "kind": "text",
                    "startMs": 2000,
                    "endMs": 3000,
                    "text": "Plain",
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                    "style": {
                        "fontFamily": "Georgia",
                        "fontWeight": 500,
                        "italic": True,
                        "size": 60,
                        "letterSpacing": 0.02,
                        "lineHeight": 1.2,
                        "align": "left",
                        "case": "none",
                        "color": "#fff7ed",
                    },
                },
            ],
        },
        {
            "id": "track_el",
            "kind": "element",
            "name": "Elements",
            "locked": True,
            "hidden": False,
            "muted": False,
            "items": [
                {
                    "id": "e1",
                    "kind": "element",
                    "startMs": 0,
                    "endMs": 1000,
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                    "element": {"type": "emoji", "emoji": "🔥"},
                },
                {
                    "id": "e2",
                    "kind": "element",
                    "startMs": 1000,
                    "endMs": 2000,
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                    "element": {
                        "type": "shape",
                        "shape": "arrow",
                        "fill": "#ffffff",
                        "stroke": "#000000",
                        "strokeWidth": 4,
                        "width": 0.3,
                        "height": 0.1,
                    },
                },
                {
                    "id": "e3",
                    "kind": "element",
                    "startMs": 2000,
                    "endMs": 3000,
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                    "element": {"type": "sticker", "stickerId": "subscribe"},
                },
            ],
        },
        {
            "id": "track_img",
            "kind": "image",
            "name": "Images",
            "locked": False,
            "hidden": True,
            "muted": False,
            "items": [
                {
                    "id": "i1",
                    "kind": "image",
                    "startMs": 0,
                    "endMs": 5000,
                    "src": "/logo.png",
                    "width": 0.2,
                    "transform": TRANSFORM,
                    "animation": ANIMATION,
                }
            ],
        },
        {
            "id": "track_sfx",
            "kind": "sfx",
            "name": "Sound effects",
            "locked": False,
            "hidden": False,
            "muted": True,
            "items": [
                {
                    "id": "s1",
                    "kind": "sfx",
                    "startMs": 500,
                    "endMs": 1300,
                    "sfxId": "whoosh",
                    "volume": 1,
                    "fadeInMs": 0,
                    "fadeOutMs": 100,
                }
            ],
        },
    ]
    return plan


async def test_put_and_get_v3_plan(client: AsyncClient, project_id: str) -> None:
    plan = v3_plan()
    created = await client.put(plan_url(project_id), json=plan)
    assert created.status_code == 200, created.json()
    fetched = await client.get(plan_url(project_id))
    assert fetched.json()["plan"] == plan


async def test_v2_plan_can_be_replaced_by_v3(
    client: AsyncClient, project_id: str, plan: dict[str, Any]
) -> None:
    url = plan_url(project_id)
    await client.put(url, json=plan)
    updated = await client.put(url, json=v3_plan(), headers={"If-Match": '"1"'})
    assert updated.status_code == 200
    assert updated.json()["plan"]["version"] == 3


Breaker = Callable[[dict[str, Any]], None]


def _break_color(p: dict[str, Any]) -> None:
    p["tracks"][0]["items"][0]["style"]["color"] = "white"


def _break_kind(p: dict[str, Any]) -> None:
    p["tracks"][0]["kind"] = "image"


def _break_element(p: dict[str, Any]) -> None:
    p["tracks"][1]["items"][0]["element"] = {"type": "blob"}


def _break_transform(p: dict[str, Any]) -> None:
    p["tracks"][0]["items"][0]["transform"] = {**TRANSFORM, "opacity": 2}


@pytest.mark.parametrize("breaker", [_break_color, _break_kind, _break_element, _break_transform])
async def test_put_rejects_invalid_v3_plan(
    client: AsyncClient, project_id: str, breaker: Breaker
) -> None:
    plan = v3_plan()
    breaker(plan)
    response = await client.put(plan_url(project_id), json=plan)
    assert response.status_code == 422
