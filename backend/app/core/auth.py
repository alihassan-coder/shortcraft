"""Verify Supabase Auth access tokens (JWTs).

Supabase signs tokens either with the legacy shared secret (HS256, `SUPABASE_JWT_SECRET`) or
with asymmetric signing keys (RS256/ES256) published at the project's JWKS URL. We accept both:
the token header's `alg` picks the method.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any

import jwt
from anyio import to_thread

from app.core.config import Settings
from app.core.errors import UnauthorizedError

ASYMMETRIC_ALGS = ("RS256", "ES256", "EdDSA")


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: uuid.UUID
    email: str | None = None
    role: str | None = None
    claims: dict[str, Any] = field(default_factory=dict, repr=False)


class TokenVerifier:
    def __init__(self, settings: Settings) -> None:
        self.secret = (
            settings.supabase_jwt_secret.get_secret_value()
            if settings.supabase_jwt_secret
            else None
        )
        self.audience = settings.supabase_jwt_audience
        self.issuer = (
            f"{settings.supabase_url.rstrip('/')}/auth/v1" if settings.supabase_url else None
        )
        jwks_url = settings.jwks_url
        self.jwks = jwt.PyJWKClient(jwks_url, cache_keys=True) if jwks_url else None

    @property
    def configured(self) -> bool:
        return bool(self.secret or self.jwks)

    async def verify(self, token: str) -> CurrentUser:
        try:
            header = jwt.get_unverified_header(token)
            alg = header.get("alg")
            if alg == "HS256" and self.secret:
                key: Any = self.secret
            elif alg in ASYMMETRIC_ALGS and self.jwks:
                # Fetches (and caches) the JWKS over the network; keep it off the event loop.
                signing_key = await to_thread.run_sync(self.jwks.get_signing_key_from_jwt, token)
                key = signing_key.key
            else:
                raise UnauthorizedError("Unsupported token signing algorithm")
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self.audience,
                issuer=self.issuer,
                options={"require": ["exp", "sub"]},
                leeway=10,
            )
        except jwt.ExpiredSignatureError as exc:
            raise UnauthorizedError("Token has expired") from exc
        except (jwt.PyJWTError, ValueError) as exc:
            raise UnauthorizedError("Invalid token") from exc
        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as exc:
            raise UnauthorizedError("Invalid token subject") from exc
        return CurrentUser(
            id=user_id, email=claims.get("email"), role=claims.get("role"), claims=claims
        )
