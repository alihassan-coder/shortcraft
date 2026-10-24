"""Supabase JWT verification (optional auth) with a test secret and a test EC key."""

import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import AsyncClient

from app.main import create_app
from tests.conftest import _client_for, make_settings

SECRET = "test-only-jwt-secret-0123456789abcdef"
SUPABASE_URL = "https://testref.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"


def make_token(key: Any = SECRET, alg: str = "HS256", **overrides: Any) -> str:
    claims: dict[str, Any] = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "email": "user@example.com",
        "exp": int(time.time()) + 600,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": "test-kid"})


async def _client(tmp_path: Path, **overrides: Any) -> AsyncIterator[AsyncClient]:
    values: dict[str, Any] = {"supabase_url": SUPABASE_URL, "supabase_jwt_secret": SECRET}
    settings = make_settings(tmp_path, **(values | overrides))
    async for http in _client_for(create_app(settings)):
        yield http


@pytest.fixture
async def auth_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    async for http in _client(tmp_path):
        yield http


@pytest.fixture
async def strict_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    async for http in _client(tmp_path, auth_required=True):
        yield http


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def create(client: AsyncClient, headers: dict[str, str] | None = None) -> Any:
    return await client.post("/api/v1/projects", json={"title": "Mine"}, headers=headers)


async def test_valid_token_sets_owner(auth_client: AsyncClient) -> None:
    user_id = str(uuid.uuid4())
    response = await create(auth_client, bearer(make_token(sub=user_id)))
    assert response.status_code == 201
    assert response.json()["owner_id"] == user_id


async def test_anonymous_allowed_when_not_required(auth_client: AsyncClient) -> None:
    response = await create(auth_client)
    assert response.status_code == 201
    assert response.json()["owner_id"] is None


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(make_token(key="wrong-secret-0123456789abcdef0123"), id="bad-signature"),
        pytest.param(make_token(aud="anon-other"), id="wrong-audience"),
        pytest.param(make_token(iss="https://evil.example/auth/v1"), id="wrong-issuer"),
        pytest.param(make_token(sub="not-a-uuid"), id="bad-sub"),
        pytest.param("not.a.jwt", id="garbage"),
    ],
)
async def test_invalid_token_rejected(auth_client: AsyncClient, token: str) -> None:
    response = await create(auth_client, bearer(token))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


async def test_expired_token_rejected(auth_client: AsyncClient) -> None:
    response = await create(auth_client, bearer(make_token(exp=int(time.time()) - 3600)))
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Token has expired"


async def test_auth_required(strict_client: AsyncClient) -> None:
    assert (await create(strict_client)).status_code == 401
    assert (await create(strict_client, bearer(make_token()))).status_code == 201


async def test_jwks_es256(tmp_path: Path) -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            return jwt.PyJWK.from_dict(
                {
                    **jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True),
                    "alg": "ES256",
                }
            )

    async for http in _client(tmp_path, supabase_jwt_secret=None):
        app = http._transport.app  # type: ignore[attr-defined]
        verifier = app.state.token_verifier
        assert verifier.jwks is not None  # built from SUPABASE_URL
        verifier.jwks = FakeJWKS()
        user_id = str(uuid.uuid4())
        good = await create(http, bearer(make_token(private_key, "ES256", sub=user_id)))
        assert good.status_code == 201
        assert good.json()["owner_id"] == user_id
        # An HS256 token is refused when no shared secret is configured.
        assert (await create(http, bearer(make_token()))).status_code == 401
