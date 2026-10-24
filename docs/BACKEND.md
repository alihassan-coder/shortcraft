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
  |                             - LocalStorage           - InProcess (asyncio) |
  |                             - R2Storage (boto3)      - Arq (Redis)         |
  +--------|-------------------------|------------------------|---------------+
           v                         v                        v
   SQLite (no .env / tests)    backend/var/uploads      worker/runner.run_job
   Supabase Postgres (asyncpg) Cloudflare R2 (S3 API)    in the API process (no Redis)
                                                         or `arq app.worker.main...`
                                                         -> handlers: proxy (ffmpeg, media/),
                                                            transcribe (Deepgram | fake),
                                                            plan (basic, or ai: LangGraph
                                                            agents -> OpenAI, app/ai/)
                                                         later: Remotion
```

Jobs: the API creates a `jobs` row and enqueues only its id. `run_job` (same code in both
queues) sets `running` + `started_at`, calls the handler for the kind with a `progress(0-100)`
callback, then writes `succeeded` + `result` or `failed` + `error`, and `finished_at`. Finished
jobs are never re-run; a job left `running` by a crashed worker runs again. `render` has no
handler yet and stays `queued`.

Chaining: the job context carries the queue's `enqueue`, so a handler can start the next job
(`worker/chain.py` creates the row and enqueues it; a chaining failure never fails the parent).
`proxy` succeeded + audio + `TRANSCRIBE_ON_UPLOAD` -> `transcribe`; `transcribe` succeeded +
`AUTO_PLAN` -> `plan` `{"mode": "ai" (AI_PLAN_ENABLED) or "basic", "vibe": ...}`. In-process the context points at the
same in-process queue; the arq worker uses arq's own Redis pool.

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
    api/v1/routes/          health, projects, plans, plan_edit ("describe a change"), uploads, jobs
    db/base.py              Base (naming conventions), JSON->JSONB on Postgres, UTC datetimes
    db/session.py           async engine factory (asyncpg | aiosqlite), Supabase pooler/SSL args
    db/models/              Project, Source, EditPlanRecord, Job
    schemas/edit_plan.py    Pydantic mirror of the Zod EditPlan v2
    schemas/                project, plan, upload, job request/response models
    services/               projects, plans, uploads, jobs, storage (adapters, keys), job_queue
    media/ffmpeg.py         probe, make_proxy, extract_audio, thumbnail_sprite, waveform_peaks,
                            loudness, detect_silences (async ffmpeg/ffprobe subprocesses, no shell)
    transcription/          TranscriptionProvider interface, DeepgramProvider (httpx REST),
                            FakeProvider (fixtures/fake_script.json), build_provider(settings)
    planning/basic.py       build_basic_plan(): pure non-AI first edit -> EditPlan v2 dict
    ai/                     LangGraph agents (section 4b): commands.py (EditCommand subset,
                            Pydantic), context.py (plan + transcript text), models.py
                            (init_chat_model per role), agents/*.py + prompts/*.md, graph.py,
                            rules.py (validate), apply.py (apply_ai_commands), ratelimit.py
    worker/runner.py        run_job: job lifecycle + handler registry
    worker/proxy.py         the proxy pipeline (download -> ffmpeg steps -> upload -> Source)
    worker/transcribe.py    audio-16k.wav -> provider -> transcript.json + Source.transcript_*
    worker/plan.py          transcript + silencedetect -> build_basic_plan -> next plan revision
    worker/chain.py         enqueue_followup(): start the next job from inside a job
    worker/main.py          arq WorkerSettings (`uv run arq app.worker.main.WorkerSettings`)
  migrations/               Alembic (async env, URL from settings)
  scripts/                  check_db.py, check_storage.py (PASS/FAIL against the real cloud)
  infra/r2-cors.json        bucket CORS rules to paste in the R2 dashboard
  tests/                    pytest + httpx, in-memory SQLite, moto for R2, fakeredis for arq,
                            tiny clips generated with ffmpeg (no network)
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
| GET | `/api/v1/projects/{id}/plan` | `{revision, updated_at, plan}` + `ETag: "<revision>"`. Media in `sources[].src` / `poster` may be **storage keys** (`projects/{pid}/sources/{sid}/proxy-720p.mp4`, written by the plan job) |
| GET | `/api/v1/projects/{id}/plan/resolved` | Same body + `expires_in`, with this project's storage keys in `sources[].src` / `poster` replaced by playable URLs (R2 presigned GET, or the local file route). **For playback only**: keep saving the plan from `GET /plan` (keys never expire). Other `src` values are left as they are |
| POST | `/api/v1/projects/{id}/plan/edit` | "Describe a change". Body `{request: str (1-2000 chars), plan_revision: int}` -> `{ok, commands: EditCommand[], changes: string[], message?, dropped}`. **Saves nothing**: the editor applies `commands` with its own `applyEdit` (so undo works), then saves with PUT /plan. 422 bad body, 404 no plan, 412 `plan_revision` is not the current revision, 429 `rate_limited` (per project, `Retry-After`), 503 `ai_unavailable` (no OpenAI key), 502 `ai_error` (model call failed). `ok: false` + `message` when the request can't become an edit |
| POST | `/api/v1/projects/{id}/plan/edit/stream` | Same, as Server-Sent Events: `event: progress` `{node, status: started/done/failed, detail?}` per graph node, then one `event: result` (the body above) or `event: error` `{code, message}`. Errors before the AI runs are normal JSON responses |
| PUT | `/api/v1/projects/{id}/plan` | body = EditPlan v2. First PUT creates (rev 1). Later PUTs need `If-Match: "<rev>"`: missing -> 428, stale -> 412 |
| POST | `/api/v1/projects/{id}/uploads` | `{filename, content_type, size_bytes}` -> `{source, upload}` (shapes below). Types: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; max `MAX_UPLOAD_BYTES` (2 GiB) -> else 422 / 413 |
| PUT | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: raw body, streamed to disk, capped at declared size |
| POST | `/api/v1/projects/{id}/sources/{sid}/complete` | multipart: body `{"parts": [{"partNumber", "etag"}]}`; single: no body. Finalizes multipart, HEADs the object, stores the real size, marks `uploaded` and enqueues a `proxy` job (`PROXY_ON_UPLOAD`). Idempotent (no second job) |
| POST | `/api/v1/projects/{id}/sources/{sid}/abort` | cancels a pending upload (aborts multipart, deletes bytes) -> status `aborted`. 409 if already uploaded |
| GET | `/api/v1/projects/{id}/sources/{sid}/url` | `{url, expires_in}`: R2 presigned GET (1 h) or the local content URL (`expires_in: null`). 404 until uploaded |
| GET | `/api/v1/projects/{id}/sources/{sid}/content` | local storage only: serves the video (Range supported) |
| GET | `/api/v1/projects/{id}/sources/{sid}` | source + metadata (`width`, `height` upright, `duration_ms`, `fps`, `video_codec`, `audio_codec`, `transcript_language`, `transcript_word_count`), `urls: {original, proxy, audio, sprite, sprite_index, peaks, transcript}` (each `{url, expires_in}` or null) and `proxy_job` (latest, same shape as a job) |
| GET | `/api/v1/projects/{id}/sources/{sid}/files/{artifact}` | local storage only: serves `proxy-720p.mp4`, `audio-16k.wav`, `sprite.jpg`, `sprite.json`, `peaks.json`, `transcript.json` |
| POST | `/api/v1/projects/{id}/jobs` | `{kind, source_id?, params?}` -> 202, status `queued`. `proxy` and `transcribe` (params `{language?, vibe?}`) need `source_id`. `plan` needs `source_id` and takes `{"mode": "basic" or "ai", "vibe": "energetic" or "clean" or "story"}` (bad mode/vibe -> 422 `invalid_params`). `render` has no worker yet |
| GET | `/api/v1/projects/{id}/jobs/{jid}` | `{id, kind, source_id, params, status, progress (0-100), error, result, started_at, finished_at, ...}`. A `proxy` result has `transcribe_job_id`, a `transcribe` result has `plan_job_id` (null when not chained) |

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

Then `GET .../sources/{sid}/url` gives the playback URL of the original, and
`GET .../sources/{sid}` the proxy job's progress and, once `status` is `ready`, the artifact
URLs. Object keys: `projects/{pid}/sources/{sid}/original.{ext}`; next to it the proxy job
writes `proxy-720p.mp4`, `audio-16k.wav`, `sprite.jpg`, `sprite.json`, `peaks.json`; renders
go to `projects/{pid}/renders/{job_id}.mp4`.

Proxy pipeline (`worker/proxy.py`, progress in brackets): copy the original to a temp dir under
`WORK_DIR` [10] -> `probe` [20] -> `make_proxy`: short side 720 px (never upscaled, even dims),
H.264 High CRF 23 yuv420p, AAC 128k, `+faststart`, auto-rotated, works for HEVC/.mov [60] ->
`thumbnail_sprite` from the proxy, one 160 px thumb per second (at most 100), 10 per row, index
`{interval_s, width, height, columns, rows, count, frames: [{t, x, y}]}` [70] -> if there is
audio: `extract_audio` 16 kHz mono s16 WAV [80], `waveform_peaks` 50/s scaled to the loudest
(`{peaks_per_second, duration_ms, count, peaks}`) and `loudness` (integrated LUFS in
`result.loudness_lufs`) [88] -> upload artifacts [97] -> Source `ready` with metadata and keys
[100]. Any failure sets the job `failed` with a readable `error` (e.g. `ffprobe failed: ...`;
unexpected errors as `Internal error (TypeName)`) and the source `failed`; the original is kept. Presigned upload URLs live 3 h, GET URLs 1 h.

Transcribe job (`worker/transcribe.py`): needs `Source.audio_key` (else a clear error: "no audio
track" / "not ready yet") -> download WAV [10] -> provider [80] -> `transcript.json`
`{provider, model, language, duration_ms, words: [{text, start_ms, end_ms, confidence,
filler}]}` uploaded next to the artifacts [95] -> `Source.transcript_key/_language/_word_count`
-> chain `plan` (AUTO_PLAN). Provider failures fail the job as `Transcription failed: ...`.

- **Deepgram** (`transcription/deepgram.py`): `POST https://api.deepgram.com/v1/listen` with
  `Authorization: Token <key>`, raw WAV body (`Content-Type: audio/wav`), query
  `model=nova-3&language=en&punctuate=true&smart_format=true&filler_words=true`. Words come
  from `results.channels[0].alternatives[0].words` (`punctuated_word` is shown; `start`/`end`
  seconds -> ms, rounded half up). Docs read 2026-10-24:
  developers.deepgram.com/reference/speech-to-text/listen-pre-recorded, /docs/filler-words,
  /docs/models-languages-overview. Not yet called with a real key.
- **Fillers**: a word is a filler when its bare token is one Deepgram spells as a filler (uh,
  um, mhmm, mm-mm, uh-uh, uh-huh, nuh-uh) or in the classic set (er, erm, hmm, mm, ah).
  "like" / "you know" are never marked (not detectable without context).
- **Fake** (`TRANSCRIPTION_PROVIDER=fake`, or `auto` without a key): lays out a fixed demo
  script from `transcription/fixtures/fake_script.json` to fit the WAV's length. Deterministic.

Plan job, mode `basic` (`worker/plan.py` + pure `planning/basic.build_basic_plan`): needs the
proxy + transcript -> ffmpeg `silencedetect` (SILENCE_NOISE_DB / SILENCE_MIN_S) on the WAV ->
plan -> validated with the Pydantic `EditPlan` (v2 output) -> saved as the next revision with
the same If-Match rule as the API (current revision; retried if an editor save lands in
between). It **replaces** the current plan content (as a new revision; older content is not
kept). Rules:

- **Silence cuts**: ffmpeg silences + word gaps > MIN_PAUSE_MS (also before the first / after
  the last word), minus every word's range, then CUT_PADDING_MS kept next to speech (none at
  the very start/end). Cuts shorter than 100 ms after padding are dropped. No words -> no
  silence cuts.
- **Filler cuts**: each filler word.
- **Retake cuts** (no LLM, conservative): a phrase of >= 3 words (fillers ignored) said again
  within 4 s, where the first attempt was abandoned (it drifts before the restart, at most 4
  extra words, or ends with a dash/ellipsis). Cut from the first attempt's start to the
  restart, note "You said this line twice. Kept the second take." Plain repetition ("very
  very", "I love it, I love it") is kept.
- **Captions**: preset by vibe (energetic -> bold-pop, clean -> clean, story -> story), size
  108, positionY 0.68, 2 words per line, no emojis. Highlights: per group of 6 kept words, the
  longest content word (>= 5 letters, not a stopword), earliest on ties.
- **Zooms**: at sentence starts after a pause (first word; after `.?!` + pause > MIN_PAUSE_MS;
  or any pause > 2x that), at most one per 6 s, up to 4 words long. energetic: punch 1.2,
  clean: smooth 1.1, story: smooth 1.12. Focus 0.5 / 0.33.
- **Hook**: the first sentence (fillers/retakes skipped, leading "So"/"And" dropped), at most 8
  words (cut at a comma when longer). One option; disabled when empty.
- **Music**: summer-fun / just-chill / a-new-life by vibe, volume 0.45, ducking to 0.25.
- **Canvas** 1080x1920 9:16 30 fps blur; one clip over the whole source; `src` = the proxy's
  storage key (see `GET /plan/resolved`).

### 4b. AI agents (mode `ai`, and "describe a change")

OpenAI only, through LangChain (`init_chat_model("openai:<model>")`, `langchain-openai`) and
LangGraph. Versions in `pyproject.toml`: `langgraph` 1.2, `langchain` 1.4 (for
`init_chat_model`), `langchain-core` 1.7, `langchain-openai` 1.7. Docs read 2026-10-24:
docs.langchain.com/oss/python/langgraph/use-graph-api and /streaming, /langchain/models,
/integrations/chat/openai, reference.langchain.com (ChatOpenAI.with_structured_output),
developers.openai.com/api/docs/models and /pricing.

Plan job, mode `ai` (`worker/plan.py`): the basic plan above -> graph -> validated commands ->
`apply_ai_commands` (Python port of `applyEdit` for the subset) -> `EditPlan` validation ->
next revision. No key, a graph error/timeout, no commands, or an invalid result -> the basic
plan is saved and `result.warnings` says why (the job still succeeds). `result.mode_used` is
`ai` or `basic`; `result.ai` has `{commands, changes, dropped, failed_agents, rationales}`.

```
START -> prepare_context -> cut | caption | zoom | hook | music   (parallel fan-out)
      -> director (LLM review + code merge) -> validate -> END
START -> summarize_plan -> edit_director -> validate -> END        (POST /plan/edit)
```

- **Context** (`ai/context.py`): deterministic text, same plan -> same bytes. Plan summary
  (cuts with ids/state, captions, highlights, zooms, music, hook) + transcript, one word per
  line `[i] text (start-end)` with flags F filler, X cut, H highlighted, E emoji; blank line
  between sentences; `-- pause N ms --`. Message order is shared preamble -> context ->
  agent task (-> user request), so the long prefix is the same for every call (OpenAI
  automatic prompt caching).
- **Specialists** (`ai/agents/*.py`, prompts in `ai/prompts/*.md`) answer with small strict
  Structured Outputs schemas that use word numbers (no ids, no times); code turns them into
  commands: Cut -> `cutRange` for retakes; Caption -> preset + `toggleHighlight` / `setEmoji`;
  Zoom -> `addZoom` (scale clamped 1.05-1.4, 0.6-4 s, focus 0.5/0.33); Hook -> 3 options of
  <= 8 words -> `setHook`; Music -> one of summer-fun, just-chill, forest-walk, epic-drums,
  a-new-life -> `setMusic` (volume 0.2-0.7). A failing specialist only loses its part.
- **Director**: an LLM review (`drop` proposal ids, pick the hook option), then code rules that
  always run: cuts first; no zoom overlapping a cut, zooms don't overlap and start >= 3 s
  apart, at most one per 5 s of video (max 12); no highlight/emoji on a cut word; at most one
  highlight per 4 kept words and one emoji per 20; the AI highlight set and zooms *replace*
  the basic ones (toggles / removeZoom), only when that agent succeeded.
- **Validate** (`ai/rules.py`, both graphs): resolve `#12` -> word id and `S0` -> source id;
  parse with the Pydantic `AgentCommand` union (`ai/commands.py`, camelCase like TS, unknown
  keys rejected); ids/presets/tracks must exist; clamp times to the source; drop duplicates;
  keep >= 60% of spoken (non-filler) word time, dropping cut commands from the end; the plan
  after all commands must validate. Every drop is reported with a reason.
- **Edit director** ("describe a change"): one call whose output schema is the whole command
  subset (non-strict JSON schema, so one bad command is dropped instead of failing the reply).
  `changes` are the model's own lines when nothing was dropped, else rebuilt from the
  commands.
- **Command subset** the AI may emit: setTitle, setVibe, setCanvas, setCutRules,
  toggleRestoreCut, removeCut, cutRange, toggleWordCut, setWordText, setCaptions,
  toggleHighlight, setEmoji, setZoomsEnabled, addZoom, updateZoom, updateAllZooms, removeZoom,
  setProgressBar, setMusic, setVoice, setHook. Not: clip, track and item commands.
  `apply_ai_commands` supports all of them except setCanvas / setProgressBar (skipped and
  reported; the plan job never emits them).
- **Models** (`ai/models.py`): `AgentModels.get_chat_model(role)` ->
  `init_chat_model("openai:" + (AGENT_MODEL_<ROLE> or OPENAI_MODEL_DEFAULT), timeout,
  max_retries)`; `structured()` = `with_structured_output(schema, method="json_schema",
  strict=...)` plus `.with_fallbacks([...])` on `AGENT_MODEL_FALLBACK`. Tests inject fakes
  through `create_app(settings, agent_models=...)` / `JobContext.agent_models`.
- **Tracing**: `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` are copied into the process
  environment at startup (API lifespan and worker), where LangChain reads them.
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
| `sources` | id, project_id (FK, cascade), filename, content_type, size_bytes, storage_key (unique), status `pending`/`uploaded`/`processing`/`ready`/`failed`/`aborted`, upload_id (multipart in progress), width/height (upright)/duration_ms/fps/video_codec/audio_codec and proxy_key/audio_key/sprite_key/sprite_index_key/peaks_key (filled by the proxy job), transcript_key/transcript_language/transcript_word_count (transcribe job) |
| `edit_plans` | project_id (PK + FK, one plan per project), schema_version, revision, plan (JSONB on Postgres, JSON on SQLite) |
| `jobs` | id, project_id (FK), source_id (FK, set null), kind `proxy`/`transcribe`/`plan`/`render`, params (JSON, e.g. `{"vibe": "clean"}`), status `queued`/`running`/`succeeded`/`failed`, progress 0-100, error, result (JSON), started_at, finished_at |

`proxy` jobs: phone videos are often HEVC in a `.mov`, which Chrome often cannot play, so after
upload we make a 720p H.264 MP4 proxy for the editor. Renders use the original.

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
| `JOB_QUEUE_BACKEND` | `auto` | `auto` = arq if `REDIS_URL` is set, else in-process; or force `inprocess` / `arq` |
| `REDIS_URL` | unset | e.g. `redis://localhost:6379/0`; then run the arq worker |
| `WORKER_CONCURRENCY`, `JOB_TIMEOUT_SECONDS` | `2`, `3600` | jobs at once per process; per-job / per-ffmpeg-call limit |
| `PROXY_ON_UPLOAD` | `true` | enqueue a `proxy` job when an upload completes |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | binary names on PATH or full paths |
| `WORK_DIR` | system temp | scratch dir for media jobs |
| `OPENAI_API_KEY` | unset | AI agents (OpenAI only, via LangChain + LangGraph); never logged |
| `OPENAI_MODEL_DEFAULT` | `gpt-6.1-sol` | model for roles without their own setting |
| `AGENT_MODEL_DIRECTOR`, `_CUT`, `_ZOOM`, `_EDIT` | = `OPENAI_MODEL_DEFAULT` | judgment-heavy roles |
| `AGENT_MODEL_CAPTION`, `_HOOK`, `_MUSIC` | `gpt-6-luna` | small, cheap roles |
| `AGENT_MODEL_FALLBACK` | unset | second model when a call fails |
| `AI_PLAN_ENABLED` | `true` | chained plan jobs use mode `ai` |
| `AI_TIMEOUT_SECONDS`, `AI_MAX_RETRIES` | `60`, `2` | per model call |
| `AI_EDIT_BURST`, `AI_EDIT_PER_MINUTE` | `5`, `10` | `/plan/edit` token bucket per project (in memory) |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT` | `false`, unset | optional agent tracing |
| `DEEPGRAM_API_KEY` | unset | Deepgram key (never logged or returned) |
| `TRANSCRIPTION_PROVIDER` | `auto` | `auto` = Deepgram with a key, else the offline fake; or `deepgram` / `fake` |
| `DEEPGRAM_MODEL` | `nova-3` | Deepgram pre-recorded model |
| `TRANSCRIPTION_LANGUAGE`, `DEEPGRAM_TIMEOUT_SECONDS` | `en`, `300` | default language (job params can override), request limit |
| `TRANSCRIBE_ON_UPLOAD` | `true` | enqueue `transcribe` after a successful proxy job (video has audio) |
| `AUTO_PLAN` | `true` | enqueue a basic `plan` after a successful transcribe job |
| `SILENCE_NOISE_DB`, `SILENCE_MIN_S` | `-35`, `0.35` | ffmpeg silencedetect noise floor and minimum length |
| `MIN_PAUSE_MS`, `CUT_PADDING_MS` | `400`, `120` | word gaps cut as silence; air kept next to speech |

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
uv run arq app.worker.main.WorkerSettings  # only when REDIS_URL is set
uv run pytest                              # -m unit | integration | ffmpeg
RUN_LIVE_AI=1 OPENAI_API_KEY=sk-... uv run pytest -m live_openai -s   # one real OpenAI run
uv run ruff check . && uv run ruff format --check .
```

Without Redis, jobs run inside the API process (no worker to start). With `REDIS_URL`, the API
only enqueues and the arq worker (same `.env`) runs them; both must see the same database and
storage. Tests marked `ffmpeg` generate tiny clips with ffmpeg and are skipped if it is missing.

Optional Postgres + Redis: `docker compose up -d` in `backend/`, then set
`DATABASE_URL=postgresql+asyncpg://shortcraft:shortcraft@localhost:5432/shortcraft`.

## 9. Stubbed today, and next steps

Stubbed:

- **AI agents** have never called the real OpenAI API (no key here). Model ids come from
  OpenAI's docs; schemas were checked offline with the OpenAI SDK's strict-schema converter.
  The `/plan/edit` rate limit is per process (in memory).
- **`render`** has no handler yet and stays `queued`. No progress stream yet: clients poll
  `GET .../jobs/{id}` or `GET .../sources/{sid}`.
- **Deepgram** is tested only against a hand-written response fixture and a mocked transport;
  a real call needs `DEEPGRAM_API_KEY`. Without a key, `auto` uses the fake provider (demo
  words, not real speech).
- **Plan jobs overwrite** the current plan content (as a new revision). The editor should
  reload after a plan job, and should not start one over user edits without asking.
- **Auth is optional**: `get_current_user` verifies `Authorization: Bearer <supabase jwt>`
  (HS256 legacy secret, or RS256/ES256 via JWKS; checks `aud`, `iss`, `exp`, `sub`). New
  projects get `owner_id` from the token. Nothing is scoped by owner yet, and anonymous calls
  work while `AUTH_REQUIRED=false`. A token that is sent but invalid or expired is always 401.

Next steps, roughly in order:

1. **Auth enforcement**: send the Supabase token from the editor, check/filter projects by
   `owner_id` in services, then set `AUTH_REQUIRED=true`.
2. **Job events**: an SSE endpoint for progress (the "agents working" UI), and retries with
   backoff for transient storage errors.
3. **Worker image**: a container with ffmpeg + the arq worker for deployment.
4. **Bucket hygiene**: R2 lifecycle rule to abort incomplete multipart uploads after 1 day.
5. **Transcription**: done (A1, A2). Next: try a real Deepgram key; self-hosted Whisper later.
6. **Agents**: built (section 4b), tested with fake models only. Next: one live run
   (`-m live_openai`), then the golden set + evals to tune prompts and per-role models; a
   Redis rate limiter when the API runs on several processes; face focus for zooms.
7. **Render**: Remotion render worker (or Lambda) for the `render` job, output to
   `projects/{pid}/renders/{job_id}.mp4`, download URL in `result`.
8. **Contract sync**: JSON Schema generated from Zod, checked in CI against the Pydantic models.
