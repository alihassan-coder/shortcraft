# Shortcraft — Frontend

The marketing site and the in-browser video editor.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
npm test         # unit + component tests (Vitest)
```

## Tests

| Command | What |
|---|---|
| `npm test` | Vitest: unit tests (`lib/**/*.test.ts`, node) and component tests (`components/**/*.test.tsx`, `tests/component/**`, jsdom + Testing Library) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright E2E (`tests/e2e/`): marketing pages, editor core flows, editor layout |
| `npm run test:e2e:ui` | Playwright UI mode |

Playwright starts `next dev` on port 3100 (reusing one already running there) and uses the installed Google Chrome locally. In CI it builds, runs `next start` and uses Playwright's Chromium (`npx playwright install chromium`).
Next allows one `next dev` per project folder, so if one is already running on another port, point Playwright at it with `PLAYWRIGHT_BASE_URL` (no server is started), e.g. `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test`.

Projects: `desktop` (1440×900, all specs) and `tablet` (900×1100, layout spec only). Every E2E test fails on any console error or uncaught page error (`tests/e2e/fixtures.ts`); a test can allow a known one with `consoleGuard.allow(/pattern/)`.

## Where things live

| Path | What |
|---|---|
| `app/(site)` | Marketing pages: home, features, pricing, examples, styles, about, blog |
| `app/(auth)` | Login and signup |
| `app/(editor)` | Video editor (`/editor/demo`) |
| `components/` | `site/`, `marketing/`, `editor/`, `brand/`, `ui/` (shadcn) |
| `lib/edit-plan/` | Edit plan schema, `resolveTimeline`, `applyEdit`, tests |
| `tests/` | `component/` (Vitest + Testing Library), `e2e/` (Playwright) |
| `remotion/` | The video composition used for preview and export |
| `public/media/` | Demo clips and music (Mixkit free license) |

See [`docs/BRAND.md`](../docs/BRAND.md) and [`docs/EDITOR_PLAN.md`](../docs/EDITOR_PLAN.md).
