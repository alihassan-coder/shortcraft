"""Application settings, loaded from environment variables and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    env: Literal["local", "test", "staging", "production"] = "local"
    debug: bool = False
    log_level: str = "INFO"

    # Public base URL of this API; used to build absolute URLs (e.g. local upload targets).
    public_base_url: str = "http://localhost:8000"

    # SQLAlchemy async URL. Default is a zero-setup SQLite file under backend/var/.
    # Postgres/Supabase: postgresql+asyncpg://user:pass@host:5432/dbname
    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'var' / 'shortcraft.db').as_posix()}"
    database_echo: bool = False

    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # Storage
    storage_backend: Literal["local", "r2"] = "local"
    local_storage_dir: Path = BACKEND_DIR / "var" / "uploads"
    max_upload_bytes: int = Field(default=1024 * 1024 * 1024, gt=0)  # 1 GiB
    r2_account_id: str | None = None
    r2_bucket: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_public_base_url: str | None = None

    # Jobs
    job_queue_backend: Literal["inprocess"] = "inprocess"
    redis_url: str = "redis://localhost:6379/0"

    # Third-party API keys (unused until agents/transcription land)
    anthropic_api_key: SecretStr | None = None
    deepgram_api_key: SecretStr | None = None

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
