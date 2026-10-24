# Shortcraft roadmap

The single place to see **what's done, what's next, and how each part is tested**.
Details live in [PLAN.md](PLAN.md), [EDITOR_PLAN.md](EDITOR_PLAN.md), [AI_PLAN.md](AI_PLAN.md), [BACKEND.md](BACKEND.md), [SETUP.md](SETUP.md) and [BRAND.md](BRAND.md).

**Status key:** ✅ done · 🔄 in progress · ⏳ next · ⬜ planned

---

## Track 1: Website (frontend)

| # | Part | Status | Tests |
|---|---|---|---|
| W1 | Brand system + marketing site (home, features, pricing, examples, styles, about, blog, auth pages, 404) | ✅ | Build, lint, page screenshots |
| W2 | Real auth pages wired to Supabase | ⬜ | E2E: sign up, log in, log out |
| W3 | Dashboard: projects list, upload, style picker, "agents working" screen | ⬜ | Component + E2E |

## Track 2: Editor (frontend)

| # | Part | Status | Tests |
|---|---|---|---|
| E1 | Edit plan v2, `resolveTimeline`, `applyEdit` | ✅ | 18 unit tests (Vitest) |
| E2 | Resizable/collapsible panels, breakpoints | ✅ | Browser tests (layout, persistence) |
| E3 | Pro shell: menu bar, assets tabs, inspector, ⌘K, right-click menus, save status | ✅ | Browser tests (split, palette aspect, speed 2×, custom canvas, word menu) |
| S3 | **Schema v3:** tracks of items (text, element, image, SFX) with transform, style, animation + migration v2→v3 | 🔄 | Unit tests for migration and commands |
| E4 | Pro timeline: multi-track, split/trim/drag, multi-select, zoom, thumbnails, waveforms, snapping | ⬜ | Unit (timeline math) + component + E2E |
| E5 | Canvas editing: move/resize/rotate/snap on the preview, crop, align | ⬜ | Component + E2E |
| E6 | Text, colors, stickers, filters, transitions | ⬜ | Unit + E2E |
| E7 | Audio: SFX library, music editing, fades, detach audio | ⬜ | Unit + E2E |
| E8 | Backend wiring: real uploads (R2), media library, autosave to the plan API | ⬜ | Integration (API mocks) + E2E |
| E9 | Polish: tour, performance, accessibility, phone simple mode | ⬜ | Accessibility checks, Lighthouse |

## Track 3: Backend

| # | Part | Status | Tests |
|---|---|---|---|
| B1 | FastAPI structure, projects, plans (revisions), uploads, jobs | ✅ | 20 → 52 pytest |
| B2 | Cloudflare R2 storage, Supabase Postgres, optional Supabase auth | ✅ (offline-tested) | moto S3 mocks, auth tests |
| B3 | **Owner setup:** fill `backend/.env` from SETUP.md, run the check scripts | ⏳ **you** | `check_db`, `check_storage` PASS |
| B4 | Worker (arq + Redis, with an in-process fallback) + ffmpeg jobs: preview copy, audio, thumbnails, waveform, loudness | ✅ 93 tests (63 unit, 30 integration); real Redis/R2 untested | Unit + integration with real ffmpeg on a tiny clip |
| B5 | Auth enforced, per-user projects, rate limits | ⬜ | Integration |
| B6 | Render worker (Remotion) → MP4 to R2, export API | ⬜ | Integration + a smoke render |

## Track 4: AI (OpenAI + LangChain + LangGraph)

| # | Part | Status | Tests |
|---|---|---|---|
| A1 | Transcription (Deepgram; fillers kept) → words in the plan | 🔄 | Unit with recorded responses |
| A2 | Non-AI first edit: silences (ffmpeg silencedetect + word gaps), fillers, retake heuristic | 🔄 | Unit on fixtures |
| A3 | LangGraph agents (Cut, Caption, Zoom, Hook, Music + Director) → `EditCommand[]` | ⬜ | Unit with fake LLM, schema checks |
| A4 | "Describe a change" endpoint; editor uses it instead of the mock | ⬜ | Integration + E2E |
| A5 | Face focus (MediaPipe), voice enhance (DeepFilterNet), beats | ⬜ | Unit on fixtures |
| A6 | Golden set + evals, per-agent model tuning | ⬜ | Eval scores |

## Track 5: Quality and delivery

| # | Part | Status |
|---|---|---|
| Q1 | **CI on GitHub Actions** (`.github/workflows/ci.yml`): backend lint + tests + SQLite migrations, **Postgres migrations (service container)**, frontend lint + Vitest + build, on every push/PR | 🔄 written; first run happens on your next push |
| Q2 | Frontend test setup: component tests (Testing Library), **Playwright** E2E in the repo (moving the scratch browser tests in) | 🔄 |
| Q3 | Backend integration tests against real Postgres in CI (service container) | ⬜ |
| Q4 | Deploy: frontend (Vercel), backend + worker (Railway/Fly/Render), env setup guide | ⬜ |

---

## Test strategy

| Level | Frontend | Backend |
|---|---|---|
| **Unit** | Vitest: `lib/edit-plan/*` (timeline math, commands, migration), stores | pytest: services, schemas, auth, storage adapters (moto) |
| **Component** | Vitest + Testing Library: inspector, panels, timeline items | — |
| **Integration** | API client against mocked backend | pytest + httpx against the app with SQLite (local) and Postgres (CI); ffmpeg jobs on a tiny clip |
| **End-to-end** | Playwright: open editor, cut a word, undo, change style, prompt, reload | Upload → job → plan round trip |
| **Checks** | ESLint, `tsc`, `next build` | ruff check/format, `alembic check` |

Every phase ships with its tests, and nothing is called done until they pass.
