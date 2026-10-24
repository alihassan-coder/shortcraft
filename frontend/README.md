# Shortcraft — Frontend

The marketing site and the in-browser video editor.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
npx vitest run   # unit tests (edit plan)
```

## Where things live

| Path | What |
|---|---|
| `app/(site)` | Marketing pages: home, features, pricing, examples, styles, about, blog |
| `app/(auth)` | Login and signup |
| `app/(editor)` | Video editor (`/editor/demo`) |
| `components/` | `site/`, `marketing/`, `editor/`, `brand/`, `ui/` (shadcn) |
| `lib/edit-plan/` | Edit plan schema, `resolveTimeline`, `applyEdit`, tests |
| `remotion/` | The video composition used for preview and export |
| `public/media/` | Demo clips and music (Mixkit free license) |

See [`docs/BRAND.md`](../docs/BRAND.md) and [`docs/EDITOR_PLAN.md`](../docs/EDITOR_PLAN.md).
