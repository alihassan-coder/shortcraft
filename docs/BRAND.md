# Shortcraft brand system (v1)

Direction chosen by the owner on 2026-10-24: **Clean Premium**, in the spirit of Apple and Stripe. Calm, confident and precise. The product carries the colour; the brand stays quiet around it.

## Principles

1. **The product is the hero.** Every page shows real product UI and real footage. Decoration must earn its place.
2. **One accent, used rarely.** The orange marks the brand (logo, focus and small "live" details). It never fills large areas.
3. **Generous space, strict rhythm.** Use one container, one spacing scale and one radius family.
4. **Plain words.** Describe what the user gets. Say "AI" only when it helps the user understand.
5. **Scales without redesign.** New pages are built only from the tokens and site components below.

## Logo

- **Mark:** a 9:16 frame (a short) split by one diagonal cut. The top part is ink and the bottom part is Rec orange. It reads as "a short, cut", and the shape works down to 16px.
- **Wordmark:** "Shortcraft" in Instrument Sans Semibold, with -0.02em tracking.
- **Component:** `components/brand/logo.tsx` (`<Logo />` and `<LogoMark />`).

## Colour tokens (`app/globals.css`)

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1D1D1F` | Text, primary buttons |
| `ink-2` | `#424245` | Secondary text on light surfaces |
| `muted-foreground` | `#6E6E73` | Captions, meta |
| `line` / `border` | `#E3E3E8` | Hairlines |
| `surface` | `#F5F5F7` | Section and panel backgrounds |
| `background` | `#FFFFFF` | Page |
| `rec` | `#FF5B1F` | Brand accent: logo, live dots, focus, small highlights |
| `rec-soft` | `#FFF1EA` | Accent tint behind small badges |
| `cut` | `#F04438` | Product UI only: removed words and segments |
| `caption` | `#FFD60A` | Product UI only: caption highlight inside videos |

## Type

**Instrument Sans** for everything, **Geist Mono** for timecodes and numbers in product UI.

| Token | Size / line-height / tracking | Use |
|---|---|---|
| `text-display` | 76 / 1.02 / -0.04em | Home hero only |
| `text-h1` | 56 / 1.05 / -0.035em | Page titles |
| `text-h2` | 40 / 1.1 / -0.03em | Section titles |
| `text-h3` | 24 / 1.25 / -0.015em | Card and feature titles |
| `text-lead` | 20 / 1.5 | Intro paragraphs |
| base | 16 / 1.6 | Body |

Headings use weight 600 and are never all caps. Use sentence case everywhere.

## Layout

- Container: `max-w-[1160px]` with `px-5 sm:px-8` (the `<Container>` component).
- Section rhythm: `py-24 md:py-32`. Use `<Section>`, and `tone="surface"` for grey bands.
- Radius: 12px for controls and panels, 20px for cards, 28px for large product frames, and full pills for buttons.
- Shadows: only product frames get a shadow (`shadow-frame`). Everything else uses hairlines.

## Motion

One orchestrated moment per page at most: the hero reveal. Interactions respond to the user (dragging, toggling, hover on media). There are no scroll-triggered fade-ins on every section. `prefers-reduced-motion` is respected.

## Site components (`components/site/`)

`Container`, `Section`, `PageIntro`, `ButtonLink`, `SiteHeader` (active link via `usePathname`), `SiteFooter`, `CtaBand`.

## Routes

`(site)` group: `/`, `/features`, `/pricing`, `/examples`, `/styles`, `/about`, `/blog`, `/blog/[slug]`
`(auth)` group: `/login`, `/signup`
`not-found.tsx` is the custom 404.
