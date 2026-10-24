# Shortcraft — Backend

FastAPI service in `backend/`. It owns projects, uploaded source videos, the edit plan of each
project, and background jobs (transcribe, plan, render). Run instructions: `backend/README.md`.

## 1. Architecture

```
  Next.js editor (frontend/, :3000)
        |  JSON over HTTP (CORS)          bytes: PUT upload target
        v                                        |
  +-------------------- FastAPI app (backend/app, :8000) ---------------------+
  |  api/v1/routes/*   thin HTTP layer: parse, call service, shape response    |
  |        |  Depends(): SessionDep, StorageDep, JobQueueDep, SettingsDep     |
  |        v                                                                   |
  |  services/*        business rules (projects, plans, uploads, jobs)         |
  |        |                         |                        |                |
  |        v                         v                        v                |
  |  db/ (SQLAlchemy 2 async)   StorageAdapter           JobQueue              |
  |                             - LocalStorage  [now]    - InProcess (no-op)   |
  |                             - R2Storage     [stub]   - arq + Redis [later] |
  +--------|-------------------------|------------------------|---------------+
           v                         v                        v
   SQLite (dev default)        backend/var/uploads      (worker, later:
   Postgres / Supabase (prod)  Cloudflare R2 (later)     Deepgram, Claude agents,
                                                         Remotion render)
```

Shared resources (engine, sessionmaker, storage, job queue, settings) are built once in the
`create_app()` lifespan and stored on `app.state`; dependencies in `api/deps.py` hand them to
routes. Tests build their own app with `create_app(Settings(...))`, so nothing is global.

## 2. Folder map

```
backend/
  app/
    main.py                 create_app(): lifespan, CORS, error handlers, routers
    core/config.py          Settings (pydantic-settings, env + .env)
    core/errors.py          AppError hierarchy + handlers -> {"error": {code, message, details?}}
    core/logging.py
    api/deps.py             SessionDep, StorageDep, JobQueueDep, SettingsDep
    api/v1/router.py        mounts everything under /api/v1
    api/v1/routes/          health, projects, plans, uploads, jobs
    db/base.py              Base (naming conventions), JSON->JSONB on Postgres, UTC datetimes
    db/session.py           async engine factory (asyncpg | aiosqlite)
    db/models/              Project, Source, EditPlanRecord, Job
    schemas/edit_plan.py    Pydantic mirror of the Zod EditPlan v2
    schemas/                project, plan, upload, job request/response models
    services/               projects, plans, uploads, jobs, storage (adapters), job_queue
  migrations/               Alembic (async env, URL from settings)
  tests/                    pytest + httpx against in-memory SQLite
  .env.example              every setting, documented
  docker-compose.yml        postgres:16 + redis:7 (optional)
```

## 3. API (v1)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no dependencies |
| GET | `/api/v1/health/ready` | readiness: runs `SELECT 1`, 503 if DB is down |
| GET | `/api/v1/projects?limit&offset` | newest first |
| POST | `/api/v1/projects` | `{title}` -> 201 |
| GET / PATCH / DELETE | `/api/v1/projects/{id}` | PATCH `{title}`; DELETE also removes stored files |
| GET | `/api/v1/projects/{id}/plan` | `{revision, updated_at, plan}` + `ETag: "<revision>"` |
| PUT | `/api/v1/projects/{id}/plan` | body = EditPlan v2. First PUT creates (rev 1). Later PUTs need `If-Match: "<rev>"`: missing -> 428, stale -> 412 |
| POST | `/api/v1/projects/{id}/uploads` | `{filename, content_type: video/*, size_bytes}` -> `{source, upload: {method, url, headers}}` |
| PUT | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: raw body, streamed to disk, capped at declared size |
| POST | `/api/v1/projects/{id}/sources/{sid}/complete` | marks source `uploaded` once the bytes exist (idempotent) |
| GET | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: serves the video |
| POST | `/api/v1/projects/{id}/jobs` | `{kind: transcribe|plan|render}` -> 202, status `queued` |
| GET | `/api/v1/projects/{id}/jobs/{jid}` | job status |

Interactive docs: `http://localhost:8000/docs`. Every error, including validation errors and
404s for unknown routes, uses `{"error": {"code", "message", "details"?}}`.

## 4. Request flow

Example: the editor saves a plan.

1. `PUT /api/v1/projects/{id}/plan` with `If-Match: "3"`.
2. FastAPI validates the body against `schemas/edit_plan.EditPlan` (422 on any mismatch).
3. `routes/plans.py` parses `If-Match` and calls `services/plans.save_plan`.
4. The service runs `UPDATE edit_plans SET plan=..., revision=revision+1 WHERE project_id=:id
   AND revision=3`. Zero rows updated means someone else saved first -> 412.
5. The response carries the new plan, `revision: 4` and `ETag: "4"`; the client sends that in
   its next `If-Match`.

Upload flow (the same for every storage adapter):
`POST .../uploads` -> client `PUT`s the bytes to `upload.url` with `upload.headers` ->
`POST .../sources/{sid}/complete`. With LocalStorage the URL points back at this API (and
the PUT already marks the source uploaded). With R2 it will be a presigned bucket URL, so the
`complete` call is what flips the status.

## 5. The edit plan contract

- **Source of truth for now: Zod**, `frontend/lib/edit-plan/schema.ts`.
- `backend/app/schemas/edit_plan.py` mirrors it by hand: same fields, enums, ranges and
  `version: Literal[2]`. Python names are snake_case; the wire format is camelCase via aliases,
  so stored and returned JSON looks exactly like what the frontend sends.
- Strict types (no `"false"` -> `False` coercion), unknown keys dropped like Zod's default
  `z.object`. Optional Zod fields (`filler`, `poster`, `note`) are left out of output when
  absent, so output always parses with Zod. One small difference: the backend accepts an
  explicit `null` for those optional fields (Zod does not) and drops it.
- Any change to `schema.ts` must be copied to `edit_plan.py` in the same PR. The tests cover
  a full round-trip of a valid plan.
- **Next:** generate JSON Schema from Zod (`z.toJSONSchema`) into a shared file, and in CI
  either generate the Pydantic models from it (`datamodel-code-generator`) or check the two
  for drift. A v3 plan means a new `version` literal plus a migration on both sides
  (the frontend already has `migrate.ts` for v1 -> v2).

## 6. Data model

| Table | Key columns |
|---|---|
| `projects` | id (uuid), title, created_at, updated_at |
| `sources` | id, project_id (FK, cascade), filename, content_type, size_bytes, storage_key (unique), status `pending`/`uploaded`, width/height/duration_ms (filled by a probe step later) |
| `edit_plans` | project_id (PK + FK, one plan per project), schema_version, revision, plan (JSONB on Postgres, JSON on SQLite) |
| `jobs` | id, project_id (FK), kind, status `queued`/`running`/`succeeded`/`failed`, error, result (JSON) |

Schema changes go through Alembic: `uv run alembic revision --autogenerate -m "..."`, review
the file, `uv run alembic upgrade head`. `uv run alembic check` fails if models and migrations
drift. New migration files are auto-formatted by ruff (hooks in `alembic.ini`).

## 7. Settings (env vars)

All optional; see `backend/.env.example` for the full annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `ENV` | `local` | `local`, `test`, `staging`, `production` |
| `DEBUG`, `LOG_LEVEL` | `false`, `INFO` | |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | builds absolute upload URLs |
| `DATABASE_URL` | SQLite at `backend/var/shortcraft.db` | `postgresql+asyncpg://...` for Postgres/Supabase |
| `DATABASE_ECHO` | `false` | log SQL |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated |
| `STORAGE_BACKEND` | `local` | `local` or `r2` (stub) |
| `LOCAL_STORAGE_DIR` | `backend/var/uploads` | |
| `MAX_UPLOAD_BYTES` | 1 GiB | |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | unset | for the R2 adapter |
| `JOB_QUEUE_BACKEND`, `REDIS_URL` | `inprocess`, `redis://localhost:6379/0` | for arq later |
| `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` | unset | agents / transcription later |

## 8. Run

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Optional Postgres + Redis: `docker compose up -d` in `backend/`, then set
`DATABASE_URL=postgresql+asyncpg://shortcraft:shortcraft@localhost:5432/shortcraft`.

## 9. Stubbed today, and next steps

Stubbed:

- **R2Storage**: settings exist, every method raises `NotImplementedError`.
- **Job queue**: `InProcessJobQueue` only logs. Jobs are created as `queued` and never run.
- **No auth**: every endpoint is open. `pyjwt` and `pwdlib` were already in `pyproject.toml`
  before this work and are not used yet. With Supabase Auth we will most likely verify the
  Supabase JWT and scope projects by `owner_id`.
- **Source metadata** (width/height/duration) is never filled in yet.

Next steps, roughly in order:

1. **Supabase Postgres**: set `DATABASE_URL` to the session pooler string with the
   `postgresql+asyncpg://` scheme and run `alembic upgrade head`. For the transaction pooler
   (port 6543), asyncpg needs `statement_cache_size=0` (add `connect_args` in `db/session.py`).
2. **Auth**: Supabase JWT dependency, `owner_id` on projects, row checks in services.
3. **R2 adapter**: aioboto3 S3 client, presigned PUT in `create_upload_target`, HEAD in
   `exists`, presigned GET for playback; CORS on the bucket for the editor origin.
4. **arq worker**: `ArqJobQueue` (enqueue by job id) + a `worker/` entrypoint that loads the
   job, sets `running`, does the work, writes `result`/`error`, sets the final status. Add a
   job progress/events endpoint (SSE) for the "agents working" UI.
5. **Transcription**: Deepgram job writes words into `sources[].words` of the plan; probe
   width/height/duration with ffprobe on upload complete.
6. **Agents**: Claude Director + specialists (cut, caption, zoom, music, hook) in the `plan`
   job, each writing its part of the plan, validated by `EditPlan` before saving.
7. **Render**: Remotion render worker (or Lambda) for the `render` job, output to storage,
   download URL in `result`.
8. **Contract sync**: JSON Schema generated from Zod, checked in CI against the Pydantic models.
