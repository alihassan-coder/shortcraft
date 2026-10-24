"""Postgres/Supabase URL handling for asyncpg (no database needed)."""

from pathlib import Path

from app.db.session import postgres_engine_options
from tests.conftest import make_settings

NO_CACHE_KEYS = {"statement_cache_size", "prepared_statement_cache_size"}


def test_transaction_pooler_disables_prepared_statements() -> None:
    url, args = postgres_engine_options(
        "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
    )
    assert url.drivername == "postgresql+asyncpg"
    assert args["statement_cache_size"] == 0
    assert args["prepared_statement_cache_size"] == 0
    assert callable(args["prepared_statement_name_func"])
    assert args["prepared_statement_name_func"]() != args["prepared_statement_name_func"]()
    assert args["ssl"] == "require"


def test_session_pooler_host_also_disables_cache() -> None:
    _, args = postgres_engine_options(
        "postgresql+asyncpg://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
    )
    assert args.keys() >= NO_CACHE_KEYS
    assert args["ssl"] == "require"


def test_any_port_6543_disables_cache() -> None:
    _, args = postgres_engine_options("postgresql+asyncpg://u:p@my-pgbouncer:6543/db")
    assert args.keys() >= NO_CACHE_KEYS
    assert "ssl" not in args


def test_direct_connection_keeps_cache_and_requires_ssl() -> None:
    _, args = postgres_engine_options(
        "postgresql+asyncpg://postgres:pw@db.ref.supabase.co:5432/postgres"
    )
    assert not NO_CACHE_KEYS & args.keys()
    assert args == {"ssl": "require"}


def test_sslmode_is_translated_for_asyncpg() -> None:
    url, args = postgres_engine_options(
        "postgres://u:p@localhost:5432/db?sslmode=disable&application_name=shortcraft"
    )
    assert url.drivername == "postgresql+asyncpg"
    assert "sslmode" not in url.query
    assert url.query["application_name"] == "shortcraft"
    assert args == {"ssl": "disable"}


def test_local_postgres_untouched() -> None:
    url, args = postgres_engine_options("postgresql+asyncpg://shortcraft:shortcraft@localhost/sc")
    assert args == {}
    assert url.render_as_string(hide_password=False).endswith("@localhost/sc")


def test_migrations_url_override(tmp_path: Path) -> None:
    plain = make_settings(tmp_path, database_url="postgresql+asyncpg://a@h/app")
    assert plain.migrations_database_url == "postgresql+asyncpg://a@h/app"
    split = make_settings(
        tmp_path,
        database_url="postgresql+asyncpg://a@h:6543/app",
        database_url_migrations="postgresql+asyncpg://a@h:5432/app",
    )
    assert split.migrations_database_url == "postgresql+asyncpg://a@h:5432/app"
