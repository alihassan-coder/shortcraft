"""Check the database connection from backend/.env. Run: uv run python -m scripts.check_db

Connects with the same settings as the app (and, if set, DATABASE_URL_MIGRATIONS), runs
`SELECT version()`, and prints PASS/FAIL. The password is never printed.
"""

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.db.session import create_engine


def describe(url: str) -> str:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        return f"sqlite ({parsed.database or 'memory'})"
    return f"{parsed.get_backend_name()} {parsed.host}:{parsed.port or 5432}/{parsed.database}"


async def check(label: str, url: str) -> bool:
    print(f"{label}: {describe(url)}")
    engine = create_engine(url)
    try:
        async with engine.connect() as conn:
            if make_url(url).get_backend_name() == "sqlite":
                version = (await conn.execute(text("SELECT sqlite_version()"))).scalar_one()
                version = f"SQLite {version}"
            else:
                version = (await conn.execute(text("SELECT version()"))).scalar_one()
            tables = await conn.run_sync(
                lambda sync_conn: sync_conn.dialect.has_table(sync_conn, "alembic_version")
            )
    except Exception as exc:
        message = str(exc).splitlines()[0][:200] if str(exc) else ""
        print(f"FAIL  connect: {type(exc).__name__}: {message}")
        return False
    finally:
        await engine.dispose()
    print(f"PASS  connect: {str(version)[:80]}")
    print("PASS  migrations table found" if tables else "NOTE  run: uv run alembic upgrade head")
    return True


async def main() -> int:
    settings = get_settings()
    ok = await check("App database", settings.database_url)
    if settings.database_url_migrations:
        ok = await check("Migrations database", settings.database_url_migrations) and ok
    print("\nALL PASS" if ok else "\nFAILED (see docs/SETUP.md, Troubleshooting)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
