# Shortcraft — Product & Build Plan

> One line: upload a raw short talking video (15s–3min) → AI agents turn it into a polished 9:16 short (captions, cuts, zooms, music, hook) → edit anything in the browser → export.

Agreed with the owner on 2026-10-24. This is the source of truth for what we build.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Scope | Full website (landing + app), built in parts |
| Design | **Clean Premium (Apple/Stripe)**, v4, chosen 2026-10-24. Full brand system in `docs/BRAND.md` (logo, tokens, type scale, layout rules, site components). White + ink `#1D1D1F`, one accent Rec orange `#FF5B1F`, Instrument Sans. Multi-page site with route groups `(site)` and `(auth)` |
| UI language | English. More caption languages later |
| Package manager | npm |
| Data until backend exists | Mock edit-plan JSON + owner's own 20–40s talking video |
| Editor | Runs 100% in the browser, nothing to install. Full editor on laptop/desktop; simple phone editor in a later part |
| AI | Multi-agent: specialist agents build the first edit, a Director agent handles chat edits. UI shows agents working live |
| Storage | **Supabase** for Postgres + auth, **Cloudflare R2** for video files (10 GB free, free egress, S3 API). Cloud is used in local dev too (keys in `backend/.env`). Browser uploads go straight to R2 via presigned (multipart) URLs. A 720p H.264 preview copy is made after upload because phone HEVC/.mov often won't play in Chrome. Decided 2026-10-24 |
| Core idea | AI writes an **edit plan (JSON)**, never a video. Remotion Player previews it live; MP4 rendered only on Export |

## 2. Tools

**Frontend (now):** Next.js 16, Tailwind v4, shadcn/ui, Remotion (`@remotion/player`), Zod, Zustand + zundo, Motion, react-dropzone, lucide-react, sonner, Geist/Inter.

**Backend (later):** FastAPI (uv), Claude agents (Director + specialists as tools), Deepgram (then WhisperX), job queue (arq + Redis), Supabase (auth + DB), Cloudflare R2 (video storage), Remotion render worker / Lambda, DeepFilterNet (voice), librosa (beats), MediaPipe (face position).

⚠️ Remotion license: free for individuals and companies of up to 3 people; bigger companies need a paid license.

## 3. The agents

| Agent | Job | Writes to edit plan |
|---|---|---|
| 🎙️ Transcript | Words + timings | `transcript.words` |
| ✂️ Cut | Silences, filler words, repeated/bad takes | `cuts` |
| 💬 Caption | Highlight words, emojis, style | `captions` |
| 🔍 Zoom | Important moments, face position | `zooms` |
| 🎵 Music | Mood, track, beats, ducking | `music` |
| 🪝 Hook | 3 hook-text options | `hook` |
| 🎬 Director | Runs the others, checks the plan, handles chat prompts | everything |

## 4. Features — v1

### Captions
- Word-by-word animation: pop, bounce, fade, slide, karaoke fill, typewriter
- Highlight words (AI picks, click any word to toggle), highlight color
- Emojis (AI adds, toggle each or all)
- **12 style presets**, one-click switch, live thumbnails:
  Bold Pop · Clean · Karaoke · Story · Neon · Boxed · Beast (thick outline) · Minimal · Gradient · Typewriter · Comic · Pro Subtle
- Save my own style as a custom preset
- Edit caption text / fix wrong words
- Drag position up/down, with TikTok/Reels **safe-zone guides**
- Font, size, color, outline, shadow, uppercase
- Words per line: 1 / 2 / 3 / full line
- Show/hide captions

### Cuts
- Auto-remove silences, trim speed: Natural / Fast / Extra fast (+ fine slider)
- Auto-remove filler words (um, uh, like) toggle
- Repeated / bad takes: AI marks "kept / removed", user can swap
- Edit by text: delete words in transcript → video cut there
- Cut words shown crossed out; click to restore
- "Time saved" counter (42s → 31s)

### Zooms
- AI punch-ins on key moments
- 4 styles: smooth, crash, expo, linear (+ zoom-out)
- Strength slider 110–150%
- Add / delete / move on timeline
- Center on face (mock face data until backend)
- Frequency: low / medium / high

### Music
- AI picks mood: upbeat, calm, dramatic, inspiring
- Built-in library of free, royalty-free tracks (license recorded per track) with preview and selection
- Ducking (lower under speech) toggle
- Volume, fade in/out, remove music

### Hook text
- AI writes 3 options, user picks
- Shown first 2–3s, own style
- Edit text and duration

### General
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- Shortcuts: Space play/pause, J/K/L, arrows move between words
- Autosave (browser for now)
- Click transcript word → video jumps there
- Before/after toggle
- Voice enhance toggle (UI now, real effect with backend)
- Export presets: TikTok / Reels / Shorts
- Watermark on free plan

### Later
Sound effects · B-roll · background removal · translation & dubbing · brand kit · eye-contact fix · virality score · caption/hashtag writer · phone editor · PWA

## 5. Editor layout (laptop) — easy to understand

Left side is a labeled **tool rail**, one tool = one panel, in the order a user works:

```
┌────────────────────────────────────────────────────────────────┐
│ ← My video        ↶ ↷     Before/After       [ Export ▸ ]      │
├────┬──────────────────┬───────────────────┬────────────────────┤
│ 💬 │ PANEL FOR THE    │                   │ TRANSCRIPT         │
│Capt│ SELECTED TOOL    │   9:16 PREVIEW    │ click word = jump  │
│ 🎨 │ (presets, sliders│   (Remotion)      │ delete = cut       │
│Styl│  toggles)        │   safe-zone guide │ crossed = removed  │
│ ✂️ │                  │                   │                    │
│Cuts│                  │   ▶ 0:12 / 0:31   │                    │
│ 🔍 │                  │                   │                    │
│Zoom│                  │                   │                    │
│ 🎵 │                  │                   │                    │
│Musc│                  │                   │                    │
│ 🪝 │                  │                   │                    │
│Hook│                  │                   │                    │
├────┴──────────────────┴───────────────────┴────────────────────┤
│ TIMELINE  ▸ cuts ▸ captions ▸ zooms ▸ music                    │
├────────────────────────────────────────────────────────────────┤
│ 🤖 Ask the agents: "make it more energetic"            [Send]  │
└────────────────────────────────────────────────────────────────┘
```

Phone (later): one column → preview, bottom sheets for Style / Captions / toggles, no timeline.

## 6. Pricing (placeholder)

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | 5 videos/mo, ≤3 min each, 720p, small watermark, all caption styles + cuts + zooms, 7-day storage |
| Pro | $15/mo | 30 videos/mo, 1080p, no watermark, music library, hook text, prompt editing |
| Business | $35/mo | 100 videos/mo, 4K, brand kit, B-roll, priority rendering |

## 7. Build parts

| Part | What | Status |
|---|---|---|
| 1 | Brand system + marketing site: /, /features, /pricing, /examples, /styles, /about, /blog, /blog/[slug], /login, /signup, 404 | ✅ done (v4) |
| 2 | Edit-plan JSON schema (Zod) + mock data + Remotion preview (captions, cuts, zooms, hook, music) | ✅ done: `lib/edit-plan/*`, `remotion/short-video.tsx` |
| 3 | Editor: tool rail + panels, transcript, timeline, undo/redo, shortcuts | ✅ v1 done at `/editor/demo` (mock Director for prompts, localStorage autosave). Polish pass later |
| 4 | Dashboard + upload + style picker + "agents working" screen | |
| 5 | Agent chat panel (mocked) + export screen | |
| 6 | Phone editor (simple) | |
| 7+ | Real backend: FastAPI, agents, transcription, Supabase, R2, rendering | |

Landing sections: Hero (before/after) · Logos · How it works · Features · Meet the agents · Caption styles · Pricing · FAQ · Final CTA + footer.
