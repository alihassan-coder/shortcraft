from typing import Any

from httpx import AsyncClient


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
    plan["version"] = 1
    plan["clips"] = []
    plan["captions"]["wordsPerLine"] = 4
    response = await client.put(plan_url(project_id), json=plan)
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    bad_fields = {tuple(d["loc"][1:]) for d in body["details"]}
    assert ("version",) in bad_fields
    assert ("clips",) in bad_fields
    assert ("captions", "wordsPerLine") in bad_fields
    assert (await client.get(plan_url(project_id))).status_code == 404


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
