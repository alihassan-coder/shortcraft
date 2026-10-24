# Shortcraft — Backend

FastAPI service in `backend/`. It owns projects, uploaded source videos, the edit plan of each
project, and background jobs (proxy, transcribe, plan, render). Run instructions:
`backend/README.md`. Cloud setup (Supabase + Cloudflare R2), step by step: `docs/SETUP.md`.

Hosting decision: **Supabase** for Postgres and Auth, **Cloudflare R2** for video files. Local
dev also uses the cloud when `backend/.env` has keys; without them (tests, CI) the app falls
back to SQLite + local disk automatically.

## 1. Architecture

```
  Next.js editor (frontend/, :3000)
        |  JSON over HTTP (CORS)          bytes: presigned PUT/GET straight to R2
        v                                        |
  +-------------------- FastAPI app (backend/app, :8000) ---------------------+
  |  api/v1/routes/*   thin HTTP layer: parse, call service, shape response    |
  |        |  Depends(): SessionDep, StorageDep, JobQueueDep, SettingsDep,     |
  |        |             CurrentUserDep (Supabase JWT, optional)               |
  |        v                                                                   |
  |  services/*        business rules (projects, plans, uploads, jobs)         |
  |        |                         |                        |                |
  |        v                         v                        v                |
  |  db/ (SQLAlchemy 2 async)   StorageAdapter           JobQueue              |
  |                             - LocalStorage           - InProcess (no-op)   |
  |                             - R2Storage (boto3)      - arq + Redis [later] |
  +--------|-------------------------|------------------------|---------------+
           v                         v                        v
   SQLite (no .env / tests)    backend/var/uploads      (worker, later:
   Supabase Postgres (asyncpg) Cloudflare R2 (S3 API)    ffmpeg proxy, Deepgram,
                                                         OpenAI agents, Remotion)
```

Shared resources (engine, sessionmaker, storage, job queue, token verifier, settings) are built
once in the `create_app()` lifespan and stored on `app.state`; dependencies in `api/deps.py`
hand them to routes. Tests build their own app with `create_app(Settings(...))`, so nothing is
global.

## 2. Folder map

```
backend/
  app/
    main.py                 create_app(): lifespan, CORS, error handlers, routers
    core/config.py          Settings (pydantic-settings, env + .env), allowed video types
    core/auth.py            Supabase JWT verification (HS256 secret or JWKS)
    core/errors.py          AppError hierarchy + handlers -> {"error": {code, message, details?}}
    core/logging.py
    api/deps.py             SessionDep, StorageDep, JobQueueDep, SettingsDep, CurrentUserDep
    api/v1/router.py        mounts everything under /api/v1
    api/v1/routes/          health, projects, plans, uploads, jobs
    db/base.py              Base (naming conventions), JSON->JSONB on Postgres, UTC datetimes
    db/session.py           async engine factory (asyncpg | aiosqlite), Supabase pooler/SSL args
    db/models/              Project, Source, EditPlanRecord, Job
    schemas/edit_plan.py    Pydantic mirror of the Zod EditPlan v2
    schemas/                project, plan, upload, job request/response models
    services/               projects, plans, uploads, jobs, storage (adapters, keys), job_queue
  migrations/               Alembic (async env, URL from settings)
  scripts/                  check_db.py, check_storage.py (PASS/FAIL against the real cloud)
  infra/r2-cors.json        bucket CORS rules to paste in the R2 dashboard
  tests/                    pytest + httpx, in-memory SQLite, moto for R2 (no network)
  .env.example              every setting, documented
  docker-compose.yml        postgres:16 + redis:7 (optional)
```

## 3. API (v1)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no dependencies |
| GET | `/api/v1/health/ready` | readiness: runs `SELECT 1`, 503 if DB is down |
| GET | `/api/v1/projects?limit&offset` | newest first |
| POST | `/api/v1/projects` | `{title}` -> 201. With a valid Supabase token, `owner_id` = user id |
| GET / PATCH / DELETE | `/api/v1/projects/{id}` | PATCH `{title}`; DELETE also removes stored files |
| GET | `/api/v1/projects/{id}/plan` | `{revision, updated_at, plan}` + `ETag: "<revision>"` |
| PUT | `/api/v1/projects/{id}/plan` | body = EditPlan v2. First PUT creates (rev 1). Later PUTs need `If-Match: "<rev>"`: missing -> 428, stale -> 412 |
| POST | `/api/v1/projects/{id}/uploads` | `{filename, content_type, size_bytes}` -> `{source, upload}` (shapes below). Types: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; max `MAX_UPLOAD_BYTES` (2 GiB) -> else 422 / 413 |
| PUT | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: raw body, streamed to disk, capped at declared size |
| POST | `/api/v1/projects/{id}/sources/{sid}/complete` | multipart: body `{"parts": [{"partNumber", "etag"}]}`; single: no body. Finalizes multipart, HEADs the object, stores the real size, marks `uploaded`. Idempotent |
| POST | `/api/v1/projects/{id}/sources/{sid}/abort` | cancels a pending upload (aborts multipart, deletes bytes) -> status `aborted`. 409 if already uploaded |
| GET | `/api/v1/projects/{id}/sources/{sid}/url` | `{url, expires_in}`: R2 presigned GET (1 h) or the local content URL (`expires_in: null`). 404 until uploaded |
| GET | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: serves the video (Range supported) |
| POST | `/api/v1/projects/{id}/jobs` | `{kind}`: `proxy`, `transcribe`, `plan` or `render` -> 202, status `queued` |
| GET | `/api/v1/projects/{id}/jobs/{jid}` | job status |

Interactive docs: `http://localhost:8000/docs`. Every error, including validation errors and
404s for unknown routes, uses `{"error": {"code", "message", "details"?}}`. Auth errors are 401
with code `unauthorized`; R2 failures are 502 `storage_error`.

## 4. Request flow

Example: the editor saves a plan.

1. `PUT /api/v1/projects/{id}/plan` with `If-Match: "3"`.
2. FastAPI validates the body against `schemas/edit_plan.EditPlan` (422 on any mismatch).
3. `routes/plans.py` parses `If-Match` and calls `services/plans.save_plan`.
4. The service runs `UPDATE edit_plans SET plan=..., revision=revision+1 WHERE project_id=:id
   AND revision=3`. Zero rows updated means someone else saved first -> 412.
5. The response carries the new plan, `revision: 4` and `ETag: "4"`; the client sends that in
   its next `If-Match`.

Upload flow. `POST .../uploads` returns `upload` in one of two shapes:

- `{"mode": "single", "method": "PUT", "url", "headers": {"Content-Type": ...}}`: PUT the whole
  file to `url` with exactly these headers. Used by LocalStorage (the URL points back at this
  API, and that PUT already marks the source uploaded) and by R2 for files up to 100 MiB
  (presigned URL; then call `complete`).
- `{"mode": "multipart", "uploadId", "partSize", "parts": [{"partNumber", "url"}]}`: R2 files
  over 100 MiB. Slice the file into `partSize` (10 MiB) chunks, PUT chunk N to part N's URL
  (parallel is fine, retry a failed part), read each response's `ETag` header (the bucket CORS
  must expose it), then `POST .../complete` with `{"parts": [{"partNumber", "etag"}]}`.

Then `GET .../sources/{sid}/url` gives the playback URL. Object keys:
`projects/{pid}/sources/{sid}/original.{ext}`, proxy `.../sources/{sid}/proxy-720p.mp4`,
renders `projects/{pid}/renders/{job_id}.mp4`. Presigned upload URLs live 3 h, GET URLs 1 h.
boto3 network calls run in a worker thread; presigning is local.

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
| `projects` | id (uuid), title, owner_id (Supabase user id, nullable, indexed), created_at, updated_at |
| `sources` | id, project_id (FK, cascade), filename, content_type, size_bytes, storage_key (unique), status `pending`/`uploaded`/`aborted`, upload_id (multipart in progress), width/height/duration_ms (filled by a probe step later) |
| `edit_plans` | project_id (PK + FK, one plan per project), schema_version, revision, plan (JSONB on Postgres, JSON on SQLite) |
| `jobs` | id, project_id (FK), kind `proxy`/`transcribe`/`plan`/`render`, status `queued`/`running`/`succeeded`/`failed`, error, result (JSON) |

`proxy` jobs (worker comes later): phone videos are often HEVC in a `.mov`, which Chrome often
cannot play, so after upload we make a 720p H.264 MP4 proxy for the editor. Renders use the
original.

Schema changes go through Alembic: `uv run alembic revision --autogenerate -m "..."`, review
the file, `uv run alembic upgrade head`. `uv run alembic check` fails if models and migrations
drift. New migration files are auto-formatted by ruff (hooks in `alembic.ini`). Alembic uses
`DATABASE_URL_MIGRATIONS` if set, else `DATABASE_URL`.

## 7. Settings (env vars)

All optional; see `backend/.env.example` for the full annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `ENV` | `local` | `local`, `test`, `staging`, `production` |
| `DEBUG`, `LOG_LEVEL` | `false`, `INFO` | |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | builds absolute local upload/playback URLs |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated |
| `DATABASE_URL` | SQLite at `backend/var/shortcraft.db` | `postgresql+asyncpg://...`; Supabase session pooler (5432) recommended. See below |
| `DATABASE_URL_MIGRATIONS` | = `DATABASE_URL` | Alembic only (direct or session connection) |
| `DATABASE_ECHO` | `false` | log SQL |
| `STORAGE_BACKEND` | `local` | `local` or `r2` (the app refuses to start if `r2` and R2 vars are missing) |
| `LOCAL_STORAGE_DIR` | `backend/var/uploads` | |
| `MAX_UPLOAD_BYTES` | 2 GiB | hard max 5 GiB |
| `MULTIPART_THRESHOLD_BYTES`, `MULTIPART_PART_SIZE_BYTES` | 100 MiB, 10 MiB | |
| `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS` | 10800, 3600 | presigned URL lifetimes |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | unset | required for `r2` |
| `R2_PUBLIC_BASE_URL`, `R2_ENDPOINT_URL` | unset | public domain instead of presigned GETs; endpoint override |
| `AUTH_REQUIRED` | `false` | `true` = 401 without a valid Supabase token |
| `SUPABASE_URL` | unset | issuer check + default JWKS URL |
| `SUPABASE_JWT_SECRET` | unset | legacy HS256 secret (else JWKS is used) |
| `SUPABASE_JWKS_URL`, `SUPABASE_JWT_AUDIENCE` | from URL, `authenticated` | |
| `JOB_QUEUE_BACKEND`, `REDIS_URL` | `inprocess`, `redis://localhost:6379/0` | for arq later |
| `OPENAI_API_KEY`, `OPENAI_MODEL_DEFAULT` | unset | AI agents later (OpenAI only, via LangChain + LangGraph) |
| `LANGSMITH_API_KEY`, `LANGSMITH_TRACING` | unset, `false` | optional agent tracing |
| `DEEPGRAM_API_KEY` | unset | transcription later |

Postgres URL handling (`db/session.py`): `postgresql://` / `postgres://` become
`postgresql+asyncpg://`; libpq `sslmode=` becomes asyncpg `ssl=`; Supabase hosts get
`ssl=require` by default; for port 6543 (transaction pooler) or any `*.pooler.supabase.com`
host, prepared-statement caches are turned off (`statement_cache_size=0`,
`prepared_statement_cache_size=0`) and statement names are unique per statement.

## 8. Run

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python -m scripts.check_db        # with cloud keys in .env
uv run python -m scripts.check_storage   # with R2 keys in .env
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Optional Postgres + Redis: `docker compose up -d` in `backend/`, then set
`DATABASE_URL=postgresql+asyncpg://shortcraft:shortcraft@localhost:5432/shortcraft`.

## 9. Stubbed today, and next steps

Stubbed:

- **Job queue**: `InProcessJobQueue` only logs. Jobs are created as `queued` and never run
  (this includes `proxy`).
- **Auth is optional**: `get_current_user` verifies `Authorization: Bearer <supabase jwt>`
  (HS256 legacy secret, or RS256/ES256 via JWKS; checks `aud`, `iss`, `exp`, `sub`). New
  projects get `owner_id` from the token. Nothing is scoped by owner yet, and anonymous calls
  work while `AUTH_REQUIRED=false`. A token that is sent but invalid or expired is always 401.
- **Source metadata** (width/height/duration) is never filled in yet.

Next steps, roughly in order:

1. **Auth enforcement**: send the Supabase token from the editor, check/filter projects by
   `owner_id` in services, then set `AUTH_REQUIRED=true`.
2. **arq worker**: `ArqJobQueue` (enqueue by job id) + a `worker/` entrypoint that loads the
   job, sets `running`, does the work, writes `result`/`error`, sets the final status. Add a
   job progress/events endpoint (SSE) for the "agents working" UI.
3. **Proxy job**: ffmpeg 720p H.264 proxy after upload complete, served by `.../url`; probe
   width/height/duration with ffprobe at the same time.
4. **Bucket hygiene**: R2 lifecycle rule to abort incomplete multipart uploads after 1 day.
5. **Transcription**: Deepgram job writes words into `sources[].words` of the plan.
6. **Agents** (OpenAI via LangChain + LangGraph): Director + specialists (cut, caption, zoom, music, hook) in the `plan`
   job, each writing its part of the plan, validated by `EditPlan` before saving.
7. **Render**: Remotion render worker (or Lambda) for the `render` job, output to
   `projects/{pid}/renders/{job_id}.mp4`, download URL in `result`.
8. **Contract sync**: JSON Schema generated from Zod, checked in CI against the Pydantic models.
