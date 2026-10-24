# Shortcraft backend

FastAPI service for projects, edit plans, uploads and jobs. Architecture and roadmap:
[`../docs/BACKEND.md`](../docs/BACKEND.md).

## Requirements

- [uv](https://docs.astral.sh/uv/) (installs Python 3.14 for you)
- Optional: Docker, for Postgres + Redis via `docker-compose.yml`

## Run locally (zero setup: SQLite + local disk)

```bash
uv sync                                         # install deps from uv.lock
uv run alembic upgrade head                     # create/upgrade backend/var/shortcraft.db
uv run uvicorn app.main:app --reload --port 8000
```

- API docs: <http://localhost:8000/docs>
- Liveness: <http://localhost:8000/health>
- Readiness (DB check): <http://localhost:8000/api/v1/health/ready>

Settings come from environment variables or `backend/.env` (`cp .env.example .env`).

## Prod-like local (Postgres + Redis)

```bash
docker compose up -d
DATABASE_URL=postgresql+asyncpg://shortcraft:shortcraft@localhost:5432/shortcraft uv run alembic upgrade head
```

Put the same `DATABASE_URL` in `.env` to run the API against it.

## Everyday commands

```bash
uv run pytest                     # tests (in-memory SQLite, temp upload dir)
uv run ruff check .               # lint
uv run ruff format .              # format
uv run alembic revision --autogenerate -m "describe change"   # new migration
uv run alembic upgrade head       # apply migrations
uv run alembic check              # fail if models and migrations drifted
```
