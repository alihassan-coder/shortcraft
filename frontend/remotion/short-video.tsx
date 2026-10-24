import {
  AbsoluteFill,
  Html5Audio,
  Html5Video,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CAPTION_PRESETS, captionTextStyle, type CaptionPreset } from "@/lib/caption-presets";
import { trackById } from "@/lib/edit-plan/music-library";
import type { Clip, EditPlan } from "@/lib/edit-plan/schema";
import { sfxById } from "@/lib/edit-plan/sfx-library";
import { msToFrames, resolveTimeline, type CaptionLine, type SfxCue, type TimedWord } from "@/lib/edit-plan/timeline";
import { animate, transitionStyle } from "./animate";
import { ItemLayer } from "./items";

// Renders an EditPlan. Used by the in-browser Player now and by the render
// worker on export later, so keep it free of editor/Next.js code.
// All timing comes from resolveTimeline, so preview and export always match.

export type ShortVideoProps = { plan: EditPlan; original?: boolean };

export function planDurationInFrames(plan: EditPlan, original = false) {
  return Math.max(1, msToFrames(resolveTimeline(plan, { original }).durationMs, plan.canvas.fps));
}

export function ShortVideo({ plan, original = false }: ShortVideoProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = (frame / fps) * 1000;
  const tl = resolveTimeline(plan, { original });
  const sources = new Map(plan.sources.map((s) => [s.id, s]));
  const clips = new Map(plan.clips.map((c) => [c.id, c]));
  const preset = CAPTION_PRESETS.find((p) => p.id === plan.captions.presetId) ?? CAPTION_PRESETS[0];
  const zoom = tl.zoomAt(t);
  const track = original ? null : trackById(plan.music.trackId);
  const spans = new Map(tl.clipSpans.map((s) => [s.clipId, s]));
  const bar = plan.progressBar;

  return (
    <AbsoluteFill style={{ backgroundColor: plan.canvas.background.type === "color" ? plan.canvas.background.color : "#000" }}>
      <AbsoluteFill style={transitionStyle(tl.transitions, t)}>
        <AbsoluteFill
          style={{
            transform: zoom ? `scale(${zoom.scale})` : undefined,
            transformOrigin: zoom ? `${zoom.focusX * 100}% ${zoom.focusY * 100}%` : undefined,
          }}
        >
          {tl.pieces.map((piece) => {
            const source = sources.get(piece.sourceId);
            if (!source) return null;
            const clip = original ? undefined : clips.get(piece.clipId);
            return (
              <Sequence
                key={piece.key}
                from={msToFrames(piece.outStart, fps)}
                durationInFrames={Math.max(1, msToFrames(piece.outEnd - piece.outStart, fps))}
                premountFor={fps}
              >
                <ClipVideo
                  src={source.src}
                  trimBefore={msToFrames(piece.srcStart, fps)}
                  clip={clip}
                  span={spans.get(piece.clipId)}
                  t={t}
                  blurBackground={plan.canvas.background.type === "blur"}
                />
              </Sequence>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>

      {!original && plan.captions.enabled && <Captions plan={plan} preset={preset} lines={tl.lines} t={t} frame={frame} fps={fps} />}

      {tl.itemsAt(t).map(({ item }) => (
        <ItemLayer key={item.id} item={item} t={t} canvas={plan.canvas} />
      ))}

      {!original && plan.hook.enabled && t < plan.hook.durationMs && (
        <Hook text={plan.hook.text} t={t} durationMs={plan.hook.durationMs} />
      )}

      {!original && bar.enabled && (
        <div
          style={{
            position: "absolute",
            left: 0,
            [bar.position]: 0,
            height: bar.thickness,
            width: `${(t / Math.max(1, tl.durationMs)) * 100}%`,
            background: bar.color,
          }}
        />
      )}

      {track && <Html5Audio src={track.src} volume={(f) => musicVolume(plan, tl.words, (f / fps) * 1000, tl.durationMs)} />}

      {tl.sfxCues.map((cue) => (
        <SfxSequence key={cue.itemId} cue={cue} fps={fps} />
      ))}
    </AbsoluteFill>
  );
}

/* ---------- Clip ---------- */

const COLOR_PRESETS: Record<Clip["color"]["preset"], string> = {
  none: "",
  natural: "saturate(1.08) contrast(1.04)",
  warm: "sepia(.18) saturate(1.15) hue-rotate(-8deg)",
  cool: "saturate(1.05) hue-rotate(12deg) brightness(1.02)",
  vivid: "saturate(1.45) contrast(1.12)",
  mono: "grayscale(1) contrast(1.1)",
  film: "sepia(.25) contrast(1.08) saturate(.9) brightness(.98)",
};

export function clipFilter(clip: Clip | undefined) {
  if (!clip) return undefined;
  const c = clip.color;
  const parts = [
    COLOR_PRESETS[c.preset],
    c.brightness ? `brightness(${1 + c.brightness * 0.5})` : "",
    c.contrast ? `contrast(${1 + c.contrast * 0.6})` : "",
    c.saturation ? `saturate(${1 + c.saturation})` : "",
    c.temperature > 0 ? `sepia(${c.temperature * 0.35})` : c.temperature < 0 ? `hue-rotate(${c.temperature * -20}deg)` : "",
  ];
  return parts.filter(Boolean).join(" ") || undefined;
}

function ClipVideo({
  src,
  trimBefore,
  clip,
  span,
  t,
  blurBackground,
}: {
  src: string;
  trimBefore: number;
  clip?: Clip;
  span?: { outStart: number; outEnd: number };
  t: number;
  blurBackground: boolean;
}) {
  const f = clip?.frame;
  const crop = clip?.crop;
  const hasCrop = crop && (crop.left || crop.top || crop.right || crop.bottom);
  const filter = clipFilter(clip);
  const common = {
    src,
    trimBefore,
    playbackRate: clip?.speed ?? 1,
    pauseWhenBuffering: true,
  } as const;

  // Clip in/out animation runs over the clip's whole span in output time.
  const a = clip && span ? animate(clip.animation, t - span.outStart, span.outEnd - span.outStart) : null;
  const look: React.CSSProperties | undefined =
    clip && a
      ? {
          opacity: clip.frame.opacity * a.opacity,
          transform: `translate(${a.dx * 100}%, ${a.dy * 100}%) scale(${a.scale})`,
        }
      : undefined;

  return (
    <AbsoluteFill style={look}>
      {blurBackground && f?.fit === "fit" && (
        <Html5Video
          {...common}
          muted
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px) brightness(.7)", transform: "scale(1.15)" }}
        />
      )}
      <Html5Video
        {...common}
        volume={clip ? (clip.muted ? 0 : clip.volume) : 1}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: f?.fit === "fit" ? "contain" : "cover",
          // Chrome-only today; the render worker is Chrome, so exports are exact.
          ...(hasCrop
            ? ({ objectViewBox: `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)` } as object)
            : {}),
          filter,
          transform: f
            ? `translate(${f.x * 100}%, ${f.y * 100}%) scale(${f.scale}) rotate(${f.rotate}deg) scaleX(${f.flipH ? -1 : 1}) scaleY(${f.flipV ? -1 : 1})`
            : undefined,
        }}
      />
    </AbsoluteFill>
  );
}

/* ---------- Captions ---------- */

function Captions({
  plan,
  preset,
  lines,
  t,
  frame,
  fps,
}: {
  plan: EditPlan;
  preset: CaptionPreset;
  lines: CaptionLine[];
  t: number;
  frame: number;
  fps: number;
}) {
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  const { highlights, emojis, showEmojis, size, positionY } = plan.captions;
  const emoji = showEmojis ? line.words.find((w) => emojis[w.id] && t >= w.outStart)?.id : undefined;
  const lineFrame = frame - msToFrames(line.start, fps);

  return (
    <AbsoluteFill style={{ alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: `${positionY * 100}%`,
          transform: "translateY(-50%)",
          width: "88%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: size * 0.15,
          fontSize: size,
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        {emoji && (
          <span style={{ fontSize: size * 1.3, transform: `scale(${spring({ frame: lineFrame, fps, config: { damping: 12 } })})` }}>
            {emojis[emoji]}
          </span>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "0.28em", rowGap: "0.1em" }}>
          {line.words.map((w) => (
            <CaptionWord key={w.key} word={w} preset={preset} highlighted={highlights.includes(w.id)} t={t} frame={frame} fps={fps} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function CaptionWord({
  word,
  preset,
  highlighted,
  t,
  frame,
  fps,
}: {
  word: TimedWord;
  preset: CaptionPreset;
  highlighted: boolean;
  t: number;
  frame: number;
  fps: number;
}) {
  const spoken = t >= word.outStart;
  const karaoke = preset.animation === "karaoke";
  if (!spoken && !karaoke) return null;

  const since = frame - msToFrames(word.outStart, fps);
  const pop = spring({ frame: since, fps, config: { damping: 11, stiffness: 220 } });
  let transform: string | undefined;
  let opacity = 1;
  switch (preset.animation) {
    case "pop":
      transform = `scale(${interpolate(pop, [0, 1], [0.6, 1])})`;
      break;
    case "bounce":
      transform = `translateY(${interpolate(pop, [0, 1], [0.4, 0])}em)`;
      break;
    case "slide":
      transform = `translateX(${interpolate(pop, [0, 1], [-0.3, 0])}em)`;
      opacity = pop;
      break;
    case "fade":
      opacity = interpolate(since, [0, 5], [0, 1], { extrapolateRight: "clamp" });
      break;
  }
  let text = word.display;
  if (preset.animation === "typewriter") {
    const chars = Math.ceil(interpolate(since, [0, 6], [1, text.length], { extrapolateRight: "clamp" }));
    text = text.slice(0, chars);
  }

  return (
    <span style={{ ...captionTextStyle(preset, karaoke ? spoken : highlighted), display: "inline-block", transform, opacity }}>
      {text}
    </span>
  );
}

/* ---------- Hook ---------- */

function Hook({ text, t, durationMs }: { text: string; t: number; durationMs: number }) {
  const inP = interpolate(t, [0, 250], [0, 1], { extrapolateRight: "clamp" });
  const outP = interpolate(t, [durationMs - 250, durationMs], [1, 0], { extrapolateLeft: "clamp" });
  const p = Math.min(inP, outP);
  return (
    <AbsoluteFill style={{ alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: "11%",
          maxWidth: "82%",
          padding: "22px 34px",
          borderRadius: 28,
          background: "#fff",
          color: "#000",
          fontFamily: "var(--font-instrument), system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 58,
          lineHeight: 1.15,
          textAlign: "center",
          letterSpacing: "-0.01em",
          boxShadow: "0 12px 40px rgba(0,0,0,.25)",
          opacity: p,
          transform: `translateY(${(1 - p) * -30}px) scale(${0.96 + p * 0.04})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

/* ---------- Music ---------- */

function musicVolume(plan: EditPlan, words: TimedWord[], t: number, totalMs: number) {
  const { volume, ducking, duckTo, fadeInMs, fadeOutMs } = plan.music;
  const fadeIn = fadeInMs ? Math.min(1, t / fadeInMs) : 1;
  const fadeOut = fadeOutMs ? Math.min(1, Math.max(0, (totalMs - t) / fadeOutMs)) : 1;
  let duck = 1;
  if (ducking) {
    // Smooth 150ms ramps around speech instead of hard jumps.
    const near = words.reduce((best, w) => {
      if (t >= w.outStart && t <= w.outEnd) return 0;
      return Math.min(best, t < w.outStart ? w.outStart - t : t - w.outEnd);
    }, Infinity);
    duck = duckTo + (1 - duckTo) * Math.min(1, near / 150);
  }
  return Math.max(0, Math.min(1, volume * duck * fadeIn * fadeOut));
}

/* ---------- Sound effects ---------- */

function SfxSequence({ cue, fps }: { cue: SfxCue; fps: number }) {
  const sfx = sfxById(cue.sfxId);
  // Library entries without a checked-in file are skipped instead of 404ing mid-playback.
  if (!sfx?.available) return null;
  const length = cue.endMs - cue.startMs;
  return (
    <Sequence from={msToFrames(cue.startMs, fps)} durationInFrames={Math.max(1, msToFrames(length, fps))}>
      <Html5Audio
        src={sfx.src}
        volume={(f) => {
          const t = (f / fps) * 1000;
          const fadeIn = cue.fadeInMs ? Math.min(1, t / cue.fadeInMs) : 1;
          const fadeOut = cue.fadeOutMs ? Math.min(1, Math.max(0, (length - t) / cue.fadeOutMs)) : 1;
          return Math.max(0, Math.min(1, cue.volume * fadeIn * fadeOut));
        }}
      />
    </Sequence>
  );
}
