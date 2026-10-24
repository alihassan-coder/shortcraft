# AI plan

How Shortcraft turns a raw talking video into an edit, and how "describe a change" works.
Written 2026-10-24. Prices are from Anthropic's current list (cached 2026-10-06); verify them before launch.

---

## 1. The big idea

The AI never makes a video file. It writes an **edit plan** (JSON) using the **same edit commands the editor uses** (`frontend/lib/edit-plan/commands.ts`). This means:

- **One language for every edit.** A user's click and the AI's suggestion are both `EditCommand`s, so undo, validation and rendering work the same for both.
- **Cheap and fast.** The AI outputs a few KB of JSON, not pixels.
- **Safe.** Every command is validated with Zod (frontend) and Pydantic (backend) before it's applied. Bad AI output can't break a project.

---

## 2. Pipeline for a new upload

```
 upload ─► 1 Prepare ─► 2 Listen ─► 3 Understand ─► 4 Decide ─► 5 Check ─► editor
            (ffmpeg)    (speech)    (signals)       (Claude)    (rules)
```

| Step | What happens | Tool | AI? |
|---|---|---|---|
| **1 Prepare** | Make a 720p H.264 **preview copy** (phone HEVC/.mov won't play in Chrome), extract 16 kHz mono audio, read duration/size | **ffmpeg** | No |
| **2 Listen** | Words with exact start/end times, **including "um/uh"** | **Deepgram Nova** (API, `filler_words` on) to start; **faster-whisper / WhisperX** (self-hosted, free) later to cut cost | Speech model |
| **3 Understand** | **Silences** (voice-activity detection), **face position** per second (zoom focus), **loudness**, music **beats** | **silero-vad**, **MediaPipe**, **ffmpeg loudnorm**, **librosa** | Small ML models, no LLM |
| **4 Decide** | Repeated takes, highlight words + emojis, zoom moments, hook title options, music mood → **edit commands** | **Claude** (see §3) | LLM |
| **5 Check** | Validate commands, clamp times to the video, drop overlaps, make sure at least 60% of speech is kept, then apply to the plan | Python rules + `EditPlan` schema | No |

**Silences and filler words are found without the LLM** (step 2 gives fillers, step 3 gives silences). The LLM handles what needs judgment: which take is better, which words matter, where to zoom, what the hook should say.

> **Why Deepgram first:** Whisper models tend to **drop "um/uh"** from transcripts, and those are exactly what we need to cut. Deepgram keeps them with a flag. *(This is from my knowledge, not checked against their docs today. Verify when we integrate.)*

---

## 3. The agents (Claude)

"Multi-agent" here is a **code-controlled workflow**: our Python code calls focused specialists in parallel, then a Director merges the results. That's faster, cheaper and easier to test than one free-roaming agent.

```
                     transcript + signals (cached prefix)
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
   ✂ Cut agent   💬 Caption    🔍 Zoom     🪝 Hook       🎵 Music
   (retakes)      agent        agent       agent         agent
        └──────────────┴───────────┼───────────┴──────────────┘
                                   ▼
                         🎬 Director (merge, fix
                         conflicts, final commands)
```

| Agent | Input | Output (structured JSON) |
|---|---|---|
| **Cut** | Transcript (with fillers and silences already marked) | `cutRange` commands for repeated or bad takes, each with a note: "You said this twice, kept the second take" |
| **Caption** | Transcript | `toggleHighlight` for 1–2 key words per line, `setEmoji` (sparingly), caption preset that fits the vibe |
| **Zoom** | Transcript + face positions + emphasis | `addZoom` at punchlines and key points (style, strength, focus from the face box) |
| **Hook** | Transcript | 3 hook-title options (≤ 8 words) → `setHook` |
| **Music** | Transcript + vibe | Mood → a track id from our library, volume, ducking → `setMusic` |
| **Director** | All proposals + the user's chosen vibe | One clean, conflict-free `EditCommand[]` (for example, no zoom inside a cut) |

**"Describe a change" (prompt editing)** is one Director call:
- **Input:** the current plan, a compact summary of it and of the transcript, and the user's request.
- **Output:** `EditCommand[]` plus a short "what changed" list.

That output is exactly what the mock Director in the editor returns today (`lib/editor/mock-director.ts`), so the frontend barely changes.

### How we call Claude
- **SDK:** the official `anthropic` Python SDK in FastAPI background jobs.
- **Output format:** **structured outputs** (`output_config.format` with a JSON schema generated from the `EditCommand` schema), so the response always parses. Pydantic validates it again before use.
- **Model:** **`claude-opus-5-5`** (the current default) with **adaptive thinking**, effort set per agent:
  - Director and Cut: `medium`
  - Caption, Hook, Music: `low`
  - Prompt edit: `low`, since it's interactive and needs to be fast
- **Prompt caching:**
  - The system prompt, command schema and caption-style catalogue are frozen and come first.
  - The transcript and signals come next and are cached, so all 5 specialists + the Director reuse it.
  - Volatile data (user request, timestamps) always goes last.
- **Safety:**
  - Handle `stop_reason: "refusal"` and `max_tokens`.
  - Server-side **fallbacks** are enabled (`fallbacks: "default"`).
  - On any failure, the user still gets the non-LLM edit (silences + fillers cut, captions on). The AI makes the edit better, but nothing breaks without it.
- **Streaming** for the Director, so the "agents working" screen can show live progress.

### Cost per video (estimate)

Assumes a 1-minute video (~150 words). Timed transcript + signals ≈ 6k tokens, cached after the first call. Each specialist outputs ~1–2k tokens including thinking, the Director ~3k.

| Model | Input $/M | Output $/M | ≈ cost per video | Notes |
|---|---|---|---|---|
| **Claude Opus 5.5** (default) | $4 | $20 | **≈ $0.15–0.30** | Best judgment |
| Claude Sonnet 5.5 | $2 | $10 | ≈ $0.08–0.15 | Your call if you want it cheaper |
| Claude Haiku 5.5 | $0.10 | $0.50 | ≈ $0.01 | Possible for simple specialists (Hook, Music), after quality tests |

A 3-minute video costs about 2–3× more. **Prompt edits** cost ≈ $0.02–0.05 each on Opus 5.5.

Other costs per 1-minute video (approximate, not verified today):
- Deepgram transcription: a few cents
- Self-hosted Whisper: $0 plus server time

**Which model each agent uses is your decision.** The plan defaults to Opus 5.5 everywhere, and every agent's model is one setting, so we can test cheaper models per agent later with an eval.

---

## 4. Non-LLM AI pieces

| Job | Tool | License / cost |
|---|---|---|
| Speech → words + timings | Deepgram (API), later faster-whisper/WhisperX | Paid API / MIT (self-hosted) |
| Silence detection | silero-vad | MIT |
| Face position for zoom focus | MediaPipe Face Detection | Apache-2.0 |
| Voice clean-up ("Studio voice") | DeepFilterNet | MIT / Apache-2.0 |
| Music beats (cut-on-beat later) | librosa | ISC |
| Loudness normalization | ffmpeg `loudnorm` | LGPL/GPL (ffmpeg binary) |
| Final render | Remotion (same composition as the preview) | Remotion license (free ≤ 3 people) |

---

## 5. Quality: how we know it's good

1. **Golden set:** 20–30 real talking videos with hand-made "ideal" edits (start with the owner's own recordings).
2. **Automatic checks:**
   - commands parse
   - no cut inside a highlighted word
   - ≥ 60% of speech kept
   - zooms don't overlap cuts
   - the hook is ≤ 8 words
3. **Scored evals:** an LLM judge plus spot checks on "would you post this?". Run on every prompt change (the claude-api skill's `build-eval` and `hillclimb` flows).
4. **Live signals:** how often users undo or change each AI decision. A highlight that gets removed often is a weak highlight.

---

## 6. Build order

| Step | What | Depends on |
|---|---|---|
| A1 | Worker (arq + Redis) + ffmpeg proxy/audio jobs | Backend R2 storage (in progress) |
| A2 | Transcription job (Deepgram) → words in `sources[].words` | A1 |
| A3 | Silence (silero-vad) + filler cuts → first plan with **no LLM** | A2 |
| A4 | Claude specialists + Director → full first edit | A3 |
| A5 | `/plan/edit` endpoint for "describe a change"; frontend swaps the mock Director for it | A4 |
| A6 | Face tracking (zoom focus), DeepFilterNet voice, music beats | A3 |
| A7 | Render worker (Remotion) → MP4 to R2 | A1 |
| A8 | Golden set + evals; per-agent model and effort tuning | A4 |

---

## 7. Keys you will need (in `backend/.env`, never committed)

- `ANTHROPIC_API_KEY`: Claude (from the Anthropic Console)
- `DEEPGRAM_API_KEY`: transcription
- `REDIS_URL`: job queue (free Upstash Redis, or local)
