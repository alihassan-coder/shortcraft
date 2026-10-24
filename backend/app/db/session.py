"""Async engine factory for SQLite (dev/tests) and Postgres via asyncpg (Supabase in prod).

Supabase connection strings:
- Session pooler, port 5432 (recommended for the app): normal Postgres sessions.
- Transaction pooler, port 6543: connections are shared between transactions, so asyncpg's
  prepared-statement caches must be off (`statement_cache_size=0` for asyncpg,
  `prepared_statement_cache_size=0` for SQLAlchemy) and statement names must be unique.
  We turn this on for any `*.pooler.supabase.com` host or port 6543 (harmless in session mode).
- Direct connection (db.<ref>.supabase.co:5432) or session pooler for Alembic migrations.
Supabase requires TLS; `sslmode=require` in the URL (libpq style) is translated to asyncpg's
`ssl=require`, and Supabase hosts get `ssl=require` by default.
"""

import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

SUPABASE_HOST_MARKERS = ("supabase.co", "supabase.com")
SUPABASE_POOLER_MARKER = "pooler.supabase.com"
TRANSACTION_POOLER_PORT = 6543


def _unique_statement_name() -> str:
    return f"__asyncpg_{uuid.uuid4()}__"


def postgres_engine_options(database_url: str | URL) -> tuple[URL, dict[str, Any]]:
    """Normalize a Postgres URL for asyncpg and return (url, connect_args)."""
    url = make_url(database_url)
    if url.drivername in ("postgres", "postgresql", "postgresql+psycopg", "postgresql+psycopg2"):
        url = url.set(drivername="postgresql+asyncpg")

    query = dict(url.query)
    connect_args: dict[str, Any] = {}

    # asyncpg has no `sslmode` keyword; it takes `ssl` with the same mode names.
    sslmode = query.pop("sslmode", None)
    ssl = query.pop("ssl", None) or sslmode
    host = (url.host or "").lower()
    if ssl is None and any(marker in host for marker in SUPABASE_HOST_MARKERS):
        ssl = "require"
    if ssl is not None:
        connect_args["ssl"] = ssl if isinstance(ssl, str) else ssl[0]

    if SUPABASE_POOLER_MARKER in host or url.port == TRANSACTION_POOLER_PORT:
        connect_args |= {
            "statement_cache_size": 0,  # asyncpg's own cache
            "prepared_statement_cache_size": 0,  # SQLAlchemy's asyncpg-dialect cache
            "prepared_statement_name_func": _unique_statement_name,
        }
    return url.set(query=query), connect_args


def create_engine(database_url: str, *, echo: bool = False) -> AsyncEngine:
    url = make_url(database_url)
    if url.get_backend_name() not in ("sqlite",):
        pg_url, connect_args = postgres_engine_options(url)
        return create_async_engine(pg_url, echo=echo, pool_pre_ping=True, connect_args=connect_args)

    in_memory = url.database in (None, "", ":memory:")
    if not in_memory:
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(
        url,
        echo=echo,
        # One shared connection so every session sees the same in-memory database.
        poolclass=StaticPool if in_memory else None,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)
