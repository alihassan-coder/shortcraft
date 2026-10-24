import uuid

from httpx import AsyncClient


async def test_project_crud(client: AsyncClient) -> None:
    created = await client.post("/api/v1/projects", json={"title": "Morning vlog"})
    assert created.status_code == 201
    project = created.json()
    assert project["title"] == "Morning vlog"
    url = f"/api/v1/projects/{project['id']}"

    listed = await client.get("/api/v1/projects")
    assert [p["id"] for p in listed.json()] == [project["id"]]

    fetched = await client.get(url)
    assert fetched.json() == project

    patched = await client.patch(url, json={"title": "Evening vlog"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Evening vlog"

    deleted = await client.delete(url)
    assert deleted.status_code == 204
    assert (await client.get(url)).status_code == 404


async def test_missing_project_returns_error_shape(client: AsyncClient) -> None:
    response = await client.get(f"/api/v1/projects/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Project not found"}}


async def test_create_project_validates_title(client: AsyncClient) -> None:
    response = await client.post("/api/v1/projects", json={"title": ""})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
