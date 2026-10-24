from httpx import AsyncClient

VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"x" * 1000


async def test_local_upload_flow(client: AsyncClient, project_id: str) -> None:
    created = await client.post(
        f"/api/v1/projects/{project_id}/uploads",
        json={"filename": "my talk.mp4", "content_type": "video/mp4", "size_bytes": len(VIDEO)},
    )
    assert created.status_code == 201
    body = created.json()
    source, target = body["source"], body["upload"]
    assert source["status"] == "pending"
    assert target["method"] == "PUT"
    assert target["url"].startswith("http://test/api/v1/projects/")

    content_url = target["url"].removeprefix("http://test")
    put = await client.put(content_url, content=VIDEO, headers=target["headers"])
    assert put.status_code == 200
    assert put.json()["status"] == "uploaded"

    completed = await client.post(f"/api/v1/projects/{project_id}/sources/{source['id']}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "uploaded"

    served = await client.get(content_url)
    assert served.status_code == 200
    assert served.content == VIDEO
    assert served.headers["content-type"] == "video/mp4"


async def test_upload_rejects_body_larger_than_declared(
    client: AsyncClient, project_id: str
) -> None:
    created = await client.post(
        f"/api/v1/projects/{project_id}/uploads",
        json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10},
    )
    url = created.json()["upload"]["url"].removeprefix("http://test")
    response = await client.put(url, content=VIDEO)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


async def test_complete_before_upload_fails(client: AsyncClient, project_id: str) -> None:
    created = await client.post(
        f"/api/v1/projects/{project_id}/uploads",
        json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10},
    )
    source_id = created.json()["source"]["id"]
    response = await client.post(f"/api/v1/projects/{project_id}/sources/{source_id}/complete")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "upload_incomplete"


async def test_upload_validation(client: AsyncClient, project_id: str) -> None:
    url = f"/api/v1/projects/{project_id}/uploads"
    not_video = await client.post(
        url, json={"filename": "a.txt", "content_type": "text/plain", "size_bytes": 10}
    )
    assert not_video.status_code == 422
    too_big = await client.post(
        url, json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10**12}
    )
    assert too_big.status_code == 413
