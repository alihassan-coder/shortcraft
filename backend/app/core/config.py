"""Application settings, loaded from environment variables and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

MiB = 1024 * 1024
GiB = 1024 * MiB

# Video formats the editor accepts. Phones record .mov (often HEVC); a proxy job makes them
# playable in every browser.
ALLOWED_VIDEO_TYPES: dict[str, str] = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # --- App ---------------------------------------------------------------------------
    env: Literal["local", "test", "staging", "production"] = "local"
    debug: bool = False
    log_level: str = "INFO"

    # Public base URL of this API; used to build absolute URLs (e.g. local upload targets).
    public_base_url: str = "http://localhost:8000"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # --- Database ----------------------------------------------------------------------
    # SQLAlchemy async URL. Default is a zero-setup SQLite file under backend/var/.
    # Postgres/Supabase: postgresql+asyncpg://user:pass@host:5432/dbname
    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'var' / 'shortcraft.db').as_posix()}"
    # Optional URL used only by Alembic (e.g. Supabase direct or session connection).
    database_url_migrations: str | None = None
    database_echo: bool = False

    # --- Storage -----------------------------------------------------------------------
    storage_backend: Literal["local", "r2"] = "local"
    local_storage_dir: Path = BACKEND_DIR / "var" / "uploads"
    max_upload_bytes: int = Field(default=2 * GiB, gt=0, le=5 * GiB)
    # Files above this size use S3 multipart upload (R2 only).
    multipart_threshold_bytes: int = Field(default=100 * MiB, ge=5 * MiB)
    multipart_part_size_bytes: int = Field(default=10 * MiB, ge=5 * MiB)
    upload_url_ttl_seconds: int = Field(default=3 * 3600, gt=0, le=7 * 24 * 3600)
    download_url_ttl_seconds: int = Field(default=3600, gt=0, le=7 * 24 * 3600)

    r2_account_id: str | None = None
    r2_bucket: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: SecretStr | None = None
    # Optional public/custom domain for the bucket. Empty = private bucket + presigned GETs.
    r2_public_base_url: str | None = None
    # Override the S3 endpoint (tests, or a non-R2 S3 service). Default is built from the
    # account id.
    r2_endpoint_url: str | None = None

    # --- Auth (Supabase) ---------------------------------------------------------------
    auth_required: bool = False
    supabase_url: str | None = None
    # Legacy HS256 "JWT secret" from Supabase. Leave empty to use the JWKS (asymmetric keys).
    supabase_jwt_secret: SecretStr | None = None
    # Default: {SUPABASE_URL}/auth/v1/.well-known/jwks.json
    supabase_jwks_url: str | None = None
    supabase_jwt_audience: str = "authenticated"

    # --- Jobs --------------------------------------------------------------------------
    job_queue_backend: Literal["inprocess"] = "inprocess"
    redis_url: str = "redis://localhost:6379/0"

    # --- AI / third-party (unused until agents/transcription land) ---------------------
    # AI provider is OpenAI only (LangChain + LangGraph).
    openai_api_key: SecretStr | None = None
    # Default chat model id. No default on purpose: pick a current id from OpenAI's docs.
    openai_model_default: str | None = None
    # Optional LangSmith tracing for agent runs.
    langsmith_api_key: SecretStr | None = None
    langsmith_tracing: bool = False
    deepgram_api_key: SecretStr | None = None

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def migrations_database_url(self) -> str:
        return self.database_url_migrations or self.database_url

    @property
    def r2_endpoint(self) -> str | None:
        if self.r2_endpoint_url:
            return self.r2_endpoint_url.rstrip("/")
        if self.r2_account_id:
            return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        return None

    @property
    def jwks_url(self) -> str | None:
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return None

    def missing_r2_settings(self) -> list[str]:
        """Names (never values) of R2 settings that are required but unset."""
        required = {
            "R2_ACCOUNT_ID or R2_ENDPOINT_URL": self.r2_endpoint,
            "R2_BUCKET": self.r2_bucket,
            "R2_ACCESS_KEY_ID": self.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": self.r2_secret_access_key,
        }
        return [name for name, value in required.items() if not value]


@lru_cache
def get_settings() -> Settings:
    return Settings()
