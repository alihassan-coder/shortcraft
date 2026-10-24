import uuid

from httpx import AsyncClient


async def test_create_and_get_job(client: AsyncClient, project_id: str) -> None:
    created = await client.post(f"/api/v1/projects/{project_id}/jobs", json={"kind": "transcribe"})
    assert created.status_code == 202
    job = created.json()
    assert job["status"] == "queued"
    assert job["kind"] == "transcribe"

    fetched = await client.get(f"/api/v1/projects/{project_id}/jobs/{job['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == job["id"]


async def test_job_kind_is_validated(client: AsyncClient, project_id: str) -> None:
    response = await client.post(f"/api/v1/projects/{project_id}/jobs", json={"kind": "dance"})
    assert response.status_code == 422


async def test_unknown_job(client: AsyncClient, project_id: str) -> None:
    response = await client.get(f"/api/v1/projects/{project_id}/jobs/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_proxy_job_kind(client: AsyncClient, project_id: str) -> None:
    response = await client.post(f"/api/v1/projects/{project_id}/jobs", json={"kind": "proxy"})
    assert response.status_code == 202
    assert response.json()["kind"] == "proxy"
