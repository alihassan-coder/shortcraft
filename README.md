<div align="center">

# Shortcraft

**Raw talking video in. Ready-to-post short out.**

Upload a phone video of yourself talking. Shortcraft adds captions, cuts the pauses and “um”s, zooms in on key moments and adds music, then lets you fine-tune everything in the browser.

</div>

---

## Features

- **Animated captions:** word-by-word, 12 styles, highlights and emojis
- **Smart cuts:** removes silences, filler words and repeated takes, and you can edit by deleting text
- **Auto zoom-ins:** punch-ins on the moments that matter
- **Music:** royalty-free tracks that get quieter while you talk
- **Hook titles:** a scroll-stopping line for the first seconds
- **Describe a change:** “make it more energetic” edits the whole video
- **Browser editor:** live preview, transcript, timeline, undo/redo

## Tech stack

| Part | Stack |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, Remotion, Zustand, Zod |
| Backend | FastAPI, SQLAlchemy, Alembic, uv |
| Data | Postgres (Supabase), Cloudflare R2 for video storage |
| AI | Agents that write an edit plan (JSON) that the editor and renderer read |

## Repository structure

```
shortcraft/
├── frontend/   # Next.js website + video editor
├── backend/    # FastAPI API, database, background jobs
└── docs/       # Product plan, brand system, editor and backend notes
```

## Getting started

**Requirements:** Node.js 20+, Python 3.12+, [uv](https://docs.astral.sh/uv/)

```bash
# Frontend → http://localhost:3000
cd frontend
npm install
npm run dev

# Backend → http://localhost:8000
cd backend
uv sync
uv run alembic upgrade head
uv run fastapi dev app/main.py
```

Copy `.env.example` to `.env` in `backend/` (and in `frontend/`, if one exists) before running.

## Docs

- [Product plan](docs/PLAN.md)
- [Brand system](docs/BRAND.md)
- [Editor plan](docs/EDITOR_PLAN.md)
- [Backend](docs/BACKEND.md)

## License

All rights reserved. Not yet licensed for reuse.
