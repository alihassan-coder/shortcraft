"""Alembic environment (async).

URL: DATABASE_URL_MIGRATIONS if set, else DATABASE_URL (same settings as the app). For
Supabase use the direct or session-pooler connection for migrations.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

from app.core.config import get_settings
from app.db import models  # noqa: F401  (register all models on Base.metadata)
from app.db.base import Base
from app.db.session import create_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
database_url = get_settings().migrations_database_url


def _configure(**kwargs: object) -> None:
    context.configure(
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=database_url.startswith("sqlite"),  # SQLite needs batch ALTERs
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(url=database_url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_engine(database_url)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
