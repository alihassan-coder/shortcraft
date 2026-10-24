# Shortcraft backend

FastAPI service for projects, edit plans, uploads and jobs. Architecture and roadmap:
[`../docs/BACKEND.md`](../docs/BACKEND.md).

## Requirements

- [uv](https://docs.astral.sh/uv/) (installs Python 3.14 for you)
- [ffmpeg](https://ffmpeg.org/) (`ffmpeg` + `ffprobe` on PATH, or set `FFMPEG_PATH` /
  `FFPROBE_PATH`) for the proxy job. Without it uploads still work; proxy jobs fail with a
  clear error and the ffmpeg tests are skipped.
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

## Run against the cloud (Supabase + Cloudflare R2)

Follow [`../docs/SETUP.md`](../docs/SETUP.md) to create the accounts and fill `backend/.env`
(`DATABASE_URL`, `STORAGE_BACKEND=r2`, `R2_*`, `SUPABASE_*`). Then:

```bash
uv run alembic upgrade head            # create tables in Supabase
uv run python -m scripts.check_db      # PASS/FAIL: connects, SELECT version()
uv run python -m scripts.check_storage # PASS/FAIL: presigned PUT/GET, CORS, multipart, delete
uv run uvicorn app.main:app --reload --port 8000
```

Bucket CORS rules to paste in the R2 dashboard: [`infra/r2-cors.json`](infra/r2-cors.json).
Tests never use the cloud: they force SQLite in memory, local disk and moto (mocked S3).

## Background jobs (worker)

After an upload completes, a `proxy` job makes a 720p H.264 preview, 16 kHz mono WAV,
thumbnail sprite and waveform peaks (see `GET /api/v1/projects/{pid}/sources/{sid}`).

- **No Redis (default):** jobs run as asyncio tasks inside the API process. Nothing else to
  start. Jobs still running when the API stops are marked `failed` ("Job was interrupted").
- **With Redis:** set `REDIS_URL` (e.g. `redis://localhost:6379/0` with `docker compose up -d
  redis`); the API then only enqueues, and a separate worker runs the jobs:

```bash
uv run arq app.worker.main.WorkerSettings        # same .env as the API (DB, storage, ffmpeg)
```

`JOB_QUEUE_BACKEND=inprocess|arq` forces one mode. With arq, the API and the worker must share
the database and storage (R2, or the same `LOCAL_STORAGE_DIR`).

## Prod-like local (Postgres + Redis)

```bash
docker compose up -d
DATABASE_URL=postgresql+asyncpg://shortcraft:shortcraft@localhost:5432/shortcraft uv run alembic upgrade head
```

Put the same `DATABASE_URL` in `.env` to run the API against it.

## Everyday commands

```bash
uv run pytest                     # tests (in-memory SQLite, temp dir, moto S3; no network)
uv run pytest -m unit             # or -m integration, -m ffmpeg, -m "not ffmpeg"
uv run ruff check .               # lint
uv run ruff format .              # format
uv run alembic revision --autogenerate -m "describe change"   # new migration
uv run alembic upgrade head       # apply migrations
uv run alembic check              # fail if models and migrations drifted
```
