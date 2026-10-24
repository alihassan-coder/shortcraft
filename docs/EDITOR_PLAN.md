# Editor v2 plan

Written 2026-10-24, after editor v1 (`/editor/demo`) shipped on mock data.
The owner asked for:

- an editor that works on every screen size
- panels you can resize
- a much better timeline you can edit directly
- basic video editing: trim, split, speed, crop, size, text and more
- frame thumbnails

This plan covers all of it. The phases are ordered so that each one ships something usable on its own.

---

## 1. Goals

| Goal | What "done" looks like |
|---|---|
| **Responsive** | Usable from a 1280px laptop to a 2560px monitor; a tablet layout; a simple phone mode |
| **Adjustable layout** | Every side panel can be dragged wider or narrower and collapsed; the layout is remembered |
| **Real timeline** | Zoom in and out, scroll, frame thumbnails, waveform, a draggable playhead, snapping, several tracks |
| **Basic editing** | Split, trim, delete, reorder, duplicate, speed, volume, crop and reframe, canvas size, rotate and flip, color, text and logo overlays |
| **Still AI-first** | The AI cuts, captions and zooms keep working on top of manual edits, and the AI can make every manual edit too |

---

## 2. Architecture changes (do these first)

Using the *deep module* idea: a lot of behaviour behind a small interface, so each change happens in one place.

### 2.1 Edit plan v2: from "cuts on one video" to "clips on a timeline"

v1 only knows one source video with ranges cut out of it. Basic editing needs **clips**: pieces of a source video placed in order, each with its own trim, speed, crop and color.

```ts
EditPlan v2 {
  version: 2
  canvas:   { aspect: "9:16" | "1:1" | "4:5" | "16:9" | "custom", width, height, fps,
              background: { type: "blur" | "color", color } }
  sources:  [{ id, src, poster, width, height, durationMs, transcript }]   // more than one upload later
  clips:    [{ id, sourceId, inMs, outMs, speed, volume, muted,
               frame: { fit: "fill" | "fit", scale, x, y, rotate, flipH, flipV },
               crop:  { left, top, right, bottom },
               color: { preset, brightness, contrast, saturation, temperature } }]
  cuts:     same as v1 (source time); applied *inside* clips      // AI silence/filler/retake cuts
  zooms:    same as v1 (source time, so they follow the video when clips move)
  captions: same as v1 + per-word timing comes from the clip it plays in
  overlays: { texts: [{ id, startMs, endMs, text, style, x, y, size, animation }],
              images: [{ id, startMs, endMs, src, x, y, scale, opacity }] }  // logo / watermark
  music, hook, voice: same as v1
}
```

- **Migration:** `migrateV1toV2(plan)` creates one clip that covers the whole source, so every saved v1 plan keeps working.
- **Output time** = clips in order, each clip's range minus the active cuts, divided by its speed.

### 2.2 Module: `resolveTimeline(plan)` (the timeline resolver)

One function answers *every* timing question. Today `buildSegments`, `outputWords` and `captionLines` are called separately from 6 places.

```ts
const tl = resolveTimeline(plan)   // memoised per plan object
tl.durationMs
tl.pieces           // what plays when: [{ clipId, srcStart, srcEnd, outStart, outEnd, speed }]
tl.words / tl.lines // caption words and lines in output time
tl.toOutput(sourceId, srcMs) / tl.toSource(outMs)
tl.clipAt(outMs) / tl.zoomAt(outMs)
```

The Remotion video, preview, transcript, timeline and panels all read from this, so **preview and export can never disagree**.

### 2.3 Module: `applyEdit(plan, command)` (edit commands)

Every change goes through one pure function. It returns a new plan and never touches the UI.

```ts
type EditCommand =
  | { type: "split"; atMs }                        | { type: "trim"; clipId; edge: "in"|"out"; toMs }
  | { type: "move"; clipId; toIndex }              | { type: "delete"; clipIds; ripple: boolean }
  | { type: "duplicate"; clipId }                  | { type: "setSpeed"; clipId; speed }
  | { type: "setFrame"; clipId; frame }            | { type: "setCrop"; clipId; crop }
  | { type: "setColor"; clipId; color }            | { type: "setCanvas"; canvas }
  | { type: "addText"; text } | { type: "updateText"; … } | { type: "removeText"; id }
  | { type: "toggleWordCut"; wordId } | { type: "addZoom"; … } | …   // existing v1 edits
```

- **Two callers use it:** the editor UI (you) and the AI Director (the prompt box, and the real backend agent later).
- Undo/redo stays automatic (zundo watches the plan).
- It's easy to test: plan in, command, plan out. We add **Vitest** tests for `resolveTimeline` and `applyEdit` (with the tdd skill).

### 2.4 Store

The store gets smaller: `plan`, `dispatch(command)`, `undo`/`redo`, plus UI state (selection, timeline zoom, panel sizes). The panels stop editing plan fields directly.

---

## 3. Tools and libraries (all free)

| Need | Choice | License | Why |
|---|---|---|---|
| Resizable/collapsible panels | **shadcn `resizable`** → react-resizable-panels v4 (`Group` / `Panel` / `Separator`, `useDefaultLayout`) | MIT | Standard choice, React 19, remembers the layout |
| Timeline | **Built by us** (Pointer Events + our store) | — | Every library is either stale, built for animation keyframes, or has a restrictive or paid license |
| Frame thumbnails | **mediabunny** `CanvasSink` (WebCodecs), with `<video>` seeking as fallback | MPL-2.0 (fine for commercial use) | Fast; already used under Remotion |
| Waveform | `decodeAudioData` → peaks → canvas | — | About 60 lines, no extra playback engine |
| Crop / reframe | **react-easy-crop** (supports video) | MIT | A fixed-aspect cropper that works on video |
| Color / filters | CSS `filter` inside the Remotion composition | — | The same in preview and export |
| Tests | **Vitest** | MIT | Fast unit tests for the two core modules |

**Avoid:** Twick (its license bans SaaS use), designcombo (paid tiers), Remotion Editor Starter/Timeline ($600), wavesurfer as a timeline layer, and old `PanelGroup`/`autoSaveId` examples.

**License note:** `remotion` and `@remotion/player` are free for individuals and companies of up to 3 people. `@remotion/media-utils` is MIT. mediabunny is MPL-2.0.

---

## 4. Layout and responsiveness

```
≥1280px  (desktop)
┌─────────────────────────────── top bar ───────────────────────────────┐
│rail│ tool panel ⇔ │        preview + prompt        │⇔ transcript      │
│    │ (240–420px,  │                                │  (280–480px,     │
│    │  collapsible)│                                │   collapsible)   │
├────┴──────────────┴────────────── ⇕ ───────────────┴──────────────────┤
│ timeline (140–420px tall, collapsible)                                 │
└────────────────────────────────────────────────────────────────────────┘
⇔ ⇕ = drag handles. Sizes are saved per browser. Double-click a handle to reset it.

1024–1279px (small laptop / tablet landscape)
  The transcript becomes a tab inside the right side of the tool panel ("Tools | Transcript").

768–1023px (tablet portrait)
  Preview on top, tabs below (Tools / Transcript / Timeline), timeline full width.

<768px (phone): simple mode
  Full-screen preview, bottom sheet with Style / Captions / Cuts / Music toggles,
  no multi-track timeline. Basic trim only.
```

- Collapse and expand buttons go in the panel headers, and `[` / `]` toggle the side panels.
- The preview always keeps its true aspect ratio and fits whatever space is left.

---

## 5. Timeline v2 design

```
 ┌ toolbar ────────────────────────────────────────────────────────────────┐
 │ ✂ Split  ⌫ Delete  ⎘ Duplicate  ⏱ Speed │ Snap ◉ │ − ━━━●━━ + Fit │ 0:12.4 │
 ├ ruler  0s ·····1s·····2s·····3s··· (ticks adapt to zoom) ───────────────┤
 │ T  Text      [ Hook title ]          [ "50% OFF" ]                      │
 │ 💬 Captions   ▮▮ ▮▮▮ ▮▮ ▮▮▮▮ (words, highlights in yellow)                │
 │ 🎬 Video     [▣▣▣▣▣ clip 1 ▣▣▣▣][▣▣▣ clip 2 ▣▣▣]░cut░[▣▣ clip 3 ▣]   │
 │              ﹏﹏﹏﹏ waveform inside each clip ﹏﹏﹏﹏                      │
 │ 🔍 Zoom           [120%]        [125%]       [112%]                       │
 │ 🎵 Music     [ Summer Fun ──── ducks under voice ────────────── ]        │
 └──────────── playhead (drag to scrub) ───────────────────────────────────┘
```

**Behaviour**
- **Zoom:** Ctrl/⌘ + scroll, the slider, "Fit", or `+`/`-` keys. The horizontal scrollbar follows the playhead while playing.
- **Thumbnails:** a filmstrip from mediabunny whose density follows the zoom level. Thumbnails are cached per source.
- **Waveform:** drawn inside each clip; cut parts are dimmed and hatched.
- **Clips:** click to select, Shift-click to select several, drag to reorder, drag the edges to trim (with frame-accurate tooltips), right-click for Split / Delete / Duplicate / Speed / Detach audio.
- **Snapping:** to the playhead, clip edges, word boundaries and seconds. Hold Alt to turn it off.
- **Playhead:** drag it, click the ruler, or use ← → to move one frame and Shift+← → for one second.
- **Track headers:** show/hide and lock per track, plus mute for video and music.
- **Keyboard:** S split · Delete/Backspace delete · Shift+Delete ripple delete · D duplicate · Ctrl+C/V copy/paste a clip · Space · J/K/L.
- **Two views:** "Edited" (output time; the default for manual editing) and "Source" (the full recording with cuts shown, like v1).

---

## 6. Basic video editing features

| Area | Features | Where in the UI |
|---|---|---|
| **Cut & arrange** | Split at playhead, trim edges, delete / ripple delete, reorder, duplicate | Timeline + toolbar |
| **Speed** | 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2× and custom; captions stay in sync | Clip panel |
| **Canvas / size** | 9:16, 1:1, 4:5, 16:9 or custom width × height; 720p / 1080p / 4K; background blur or color | New **Canvas** tool |
| **Frame / reframe** | Fit or fill, scale, move (drag on the preview), rotate 90°, flip | Clip panel + handles on the preview |
| **Crop** | Crop box on the paused frame (react-easy-crop) | Clip panel → "Crop" |
| **Color** | Presets (Natural, Warm, Cool, Vivid, B&W, Film) + brightness, contrast, saturation, temperature | Clip panel → "Color" |
| **Text** | Free text overlays with styles, timing on the Text track, drag to position | New **Text** tool |
| **Logo / watermark** | Upload an image, place it, set opacity | Text tool → "Image" |
| **Audio per clip** | Volume, mute, fade | Clip panel |
| **Progress bar** (small extra) | Optional bar at top or bottom showing video progress | Canvas tool |

**Direct editing on the preview:** select a text or clip, then drag, resize or rotate it with handles right on the video. Hide the handles while playing.

---

## 7. Phases

| Phase | What ships | Size |
|---|---|---|
| **E1 — Foundation** ✅ | Schema v2 + migration, `resolveTimeline`, `applyEdit`, Vitest tests (18 passing); existing UI moved onto them with no visible change | M |
| **E2 — Layout** | shadcn resizable panels, collapse/expand, saved sizes, the 4 breakpoints above | S–M |
| **E3 — Timeline v2** | Zoom/scroll, ruler, draggable playhead, filmstrip thumbnails, waveform, track headers, snapping, Edited/Source view | L |
| **E4 — Clip editing** | Split, trim, delete/ripple, reorder, duplicate, speed, clip volume, context menu, shortcuts | M–L |
| **E5 — Canvas & frame** | Canvas tool (aspect, resolution, background), fit/fill/scale/move/rotate/flip, crop, handles on the preview | M |
| **E6 — Look & overlays** | Color presets and adjustments, text overlays, logo/watermark, progress bar | M |
| **E7 — Polish** | Real "Saved" state, empty and loading states, tooltips everywhere, performance (memoisation, thumbnail cache), accessibility pass | S–M |

**How each phase is checked:** type-check, lint, build, Vitest tests (E1 and later), and a Puppeteer browser test that drives the new features and takes screenshots. The same approach caught the bugs in v1.

---

## 8. Decisions (owner, 2026-10-24)

1. **Sizes:** all of 9:16, 1:1, 4:5, 16:9 **plus a custom width × height**.
2. **Videos:** one source video per project in this round. The schema already uses `sources[]` so adding more later is a small step.
3. **Phone simple mode:** after the backend.
4. **Order:** E1 → E7 as listed. **Replaced by §9 after the owner's review:** the editor must feel like a real editor.

---

## 9. Pro editor upgrade (owner review, 2026-10-24)

> "The editor doesn't give an editor vibe." v1 is a smart preview with settings. A real editor has a **media library**, an **inspector that follows your selection**, a **multi-track timeline you edit in directly**, **handles on the video**, right-click menus, a command palette, transitions, sound effects and stickers. This section is the plan for that. The AI features stay; they become *one* part of a full editor.

### 9.1 New layout (CapCut / Premiere-lite)

```
┌ Menu: File  Edit  View  Help ─────────── project name ── ↶ ↷ ── ⌘K ── Export ┐
├───────────────┬─────────────────────────────────────────┬────────────────────┤
│ ASSETS (tabs) │              PLAYER                     │ INSPECTOR           │
│ Media         │   ┌──────────────┐  ▸ safe zones        │ (changes with what  │
│ Text          │   │  9:16 canvas │  ▸ grid / snap       │  you select)        │
│ Captions      │   │  drag/resize │  ▸ zoom 50–200%      │ Clip: transform,    │
│ Audio · SFX   │   │  rotate on   │                      │  crop, speed, color,│
│ Elements      │   │  the video   │                      │  volume, animation  │
│ Transitions   │   └──────────────┘                      │ Text: font, style,  │
│ Filters       │  ⏮ ◀▮ ▶ ▮▶ ⏭  0:12.4/0:31  1x  ⛶       │  animation in/out   │
│ Transcript    │  ✨ Describe a change…                  │ Project: canvas     │
├───────────────┴─────────────────────────────────────────┴────────────────────┤
│ TOOLBAR  ✂Split ⌫Delete ⎘Dup ⏱Speed ⧉Detach audio │ Snap ◉ │ −━━●━━+ Fit    │
│ T  Text      ▭▭▭        ▭▭▭▭                                                 │
│ 💬 Captions  ▮▮ ▮▮▮ ▮▮ ▮▮▮▮                                                   │
│ 🎬 Main      [▣▣▣▣ clip ▣▣▣▣]◇[▣▣▣ clip ▣▣▣]   ◇ = transition                │
│ ✦ Elements      ★     🔥                                                      │
│ 🎵 Music     [────────── track ─────────]                                     │
│ 🔊 SFX          ·whoosh     ·pop                                              │
└─────────────────────────────────────────────── playhead ─────────────────────┘
```

All panels are resizable and collapsible (E2). The transcript moves into the Assets tabs (it stays a first-class way to edit).

### 9.2 Feature list

| Area | Features |
|---|---|
| **Media library** | Uploaded video, images, audio and logos; thumbnails and duration; drag onto the timeline; "used in project" badge |
| **Timeline** | Tracks: main video (magnetic), text, captions, elements, music, SFX. Split, trim, ripple, drag between tracks, multi-select (box + Shift), copy/paste, snapping, zoom/scroll, thumbnails and waveforms, markers, lock/mute/hide track, loop region |
| **Player** | Drag/resize/rotate items on the canvas with handles, snap to center and edges, safe zones, grid, preview zoom, frame step (←/→), playback speed, fullscreen |
| **Inspector: clip** | Transform (position, scale, rotation, opacity), crop, flip, speed (0.25–4×), volume, fade in/out, color (presets + sliders), filters, background (blur/color), animation in/out |
| **Text** | Presets, Google Fonts, size, color, stroke, shadow, background box, alignment, animation in/out, timing on the Text track |
| **Captions** | Everything from v1 plus per-line edit, word timing nudges, and style per word |
| **Audio** | Music library, **SFX library** (whoosh, pop, ding: free Mixkit SFX), voice enhance, ducking, fades, detach audio from a clip |
| **Elements** | Emojis, shapes, arrows, "follow" button, progress bar, logo/watermark |
| **Transitions** | Fade, slide, wipe, zoom, whip between clips on the main track |
| **Filters** | Natural, Warm, Cool, Vivid, Mono, Film, plus brightness/contrast/saturation/temperature |
| **Productivity** | Command palette (Ctrl/⌘K), right-click menus everywhere, shortcut hints in tooltips, history list, toasts, first-run tour |
| **AI (still the star)** | Describe a change, "Auto edit again", AI suggestions (hooks, highlights, zooms) you accept or reject one by one |
| **Project** | Autosave with a real "Saved / Saving…" status, rename, duplicate, export dialog with presets and a render queue |

### 9.3 Small free libraries (all MIT unless noted)

| Need | Library | Why |
|---|---|---|
| Handles on the canvas (drag, resize, rotate, snap) | **react-moveable** | Proven, used by many editors |
| Drag and drop (media to timeline, reorder) | **@dnd-kit/core** | Accessible, small |
| Command palette | **shadcn `command`** (cmdk) | Already in our UI system |
| Right-click menus | **shadcn `context-menu`** (Radix) | Already in our UI system |
| Shortcuts | **react-hotkeys-hook** | Scoped shortcuts, ignores inputs |
| Color picker | **react-colorful** | 2 KB |
| Emoji picker | **frimousse** | Small, unstyled, fits shadcn |
| Long lists (transcript, media) | **@tanstack/react-virtual** | Smooth with 3-minute transcripts |
| Toasts | **sonner** (shadcn) | Already the shadcn standard |
| Fonts | Google Fonts via `next/font` + a curated list | Free |
| Thumbnails, waveform, in-browser compress/convert | **mediabunny** (MPL-2.0) | WebCodecs: fast, no huge download |
| Transitions | **@remotion/transitions** (Remotion license) | Same engine as the preview and export |
| SFX and music | **Mixkit** free library | Free for commercial use |

**Licenses to watch:**
- The Remotion packages are free for companies of up to 3 people.
- mediabunny is MPL-2.0, which is fine for commercial use.

### 9.4 Where ffmpeg fits

| Where | ffmpeg does | Why there |
|---|---|---|
| **Backend worker (native ffmpeg)** | 720p H.264 preview copy, 16 kHz audio for transcription, thumbnail sprite sheet, waveform peaks JSON, loudness normalize, final MP4 post-processing (faststart, audio mix) | Fast, any format (HEVC/.mov), no browser limits. This is the main place ffmpeg runs |
| **Browser** | Compress or convert before upload, quick thumbnails | Use **mediabunny** (WebCodecs) first. **ffmpeg.wasm** only as a fallback: it's a ~30 MB download, slower, and its core is GPL-licensed |

### 9.5 Revised phases (replace E3–E7)

| Phase | What ships |
|---|---|
| **E2 — Layout** (in progress) | Resizable/collapsible panels, breakpoints |
| **E3 — Pro shell** | Menu bar, Assets tabs (Media, Text, Captions, Audio, Elements, Transitions, Filters, Transcript), Inspector following selection, command palette, context menus, real save status |
| **E4 — Timeline v2** | Multi-track timeline (main/text/captions/elements/music/SFX), zoom/scroll, thumbnails and waveforms, snapping, split/trim/ripple/drag/multi-select/copy-paste, markers, track lock/mute/hide |
| **E5 — Canvas editing** | react-moveable handles on the player, snap guides, transform/crop/flip in the Inspector, canvas sizes + custom, background |
| **E6 — Text, elements & look** | Text tool with fonts and animations, elements/stickers/emojis, filters and color, transitions |
| **E7 — Audio** | SFX library, music track editing, fades, detach audio, ducking control, voice enhance toggle wired to the backend |
| **E8 — Media & backend wiring** | Media library from R2 uploads, mediabunny compress-before-upload, thumbnails and waveform from the worker, autosave to the backend plan API |
| **E9 — Polish** | Tour, empty and loading states, performance (virtualization, caches), accessibility, tooltips with shortcuts |

**Schema impact:** `overlays` grows into **tracks of items** (text, element, image, sfx, each with start/end, transform and animation) and clips get `transition` + `transform` + `opacity` + `animation`. This is a **v3 schema with a migration**, like v1 → v2. `resolveTimeline` and `applyEdit` stay the only modules that know the rules.

### 9.6 Decisions (owner, 2026-10-24)

- **Layout:** CapCut-style pro layout (Assets left, Player center, Inspector right, multi-track timeline bottom). Approved.
- **All four** feature areas are wanted: pro timeline, canvas handles, text & elements, audio & SFX. They are built in the order E4 → E7 above, after E3 (pro shell).
