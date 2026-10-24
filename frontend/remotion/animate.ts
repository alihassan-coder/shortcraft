import type { CSSProperties } from "react";
import type { AnimationPhase, AnimationType, LoopAnimation } from "@/lib/edit-plan/schema";
import type { TransitionCue } from "@/lib/edit-plan/timeline";

// Pure animation math shared by track items and clips, so the Player and the
// export render compute the exact same frame.

/** Offsets are fractions of the canvas (dx of width, dy of height). `reveal` is for typewriter. */
export type AnimFrame = { opacity: number; dx: number; dy: number; scale: number; rotate: number; reveal: number };

const SLIDE = 0.05;
const DROP = 0.08;

function easeOutBounce(x: number) {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

/** Applies one phase. p goes 0 → 1 as the item becomes fully shown; `exit` flips slide directions. */
function applyPhase(f: AnimFrame, type: AnimationType, p: number, exit: boolean) {
  if (type === "none" || p >= 1) return;
  const away = 1 - p;
  const dir = exit ? -1 : 1;
  switch (type) {
    case "fade":
      f.opacity *= p;
      break;
    case "pop":
      f.scale *= 0.7 + 0.3 * p;
      f.opacity *= p;
      break;
    case "slide-up":
      f.dy += away * SLIDE * dir;
      f.opacity *= p;
      break;
    case "slide-down":
      f.dy -= away * SLIDE * dir;
      f.opacity *= p;
      break;
    case "slide-left":
      f.dx += away * SLIDE * dir;
      f.opacity *= p;
      break;
    case "slide-right":
      f.dx -= away * SLIDE * dir;
      f.opacity *= p;
      break;
    case "typewriter":
      f.reveal = Math.min(f.reveal, p);
      break;
    case "bounce":
      f.dy -= (1 - easeOutBounce(p)) * DROP * dir;
      f.opacity *= Math.min(1, p * 3);
      break;
  }
}

/** Frame of an item/clip `localMs` into its life of `lengthMs`. */
export function animate(
  anim: { in: AnimationPhase; out: AnimationPhase; loop?: LoopAnimation },
  localMs: number,
  lengthMs: number,
): AnimFrame {
  const f: AnimFrame = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, reveal: 1 };
  // In + out never overlap: shrink both if the item is shorter than they are.
  const total = anim.in.durationMs + anim.out.durationMs;
  const k = total > lengthMs && total > 0 ? lengthMs / total : 1;
  const inMs = anim.in.durationMs * k;
  const outMs = anim.out.durationMs * k;
  if (inMs > 0) applyPhase(f, anim.in.type, Math.max(0, Math.min(1, localMs / inMs)), false);
  if (outMs > 0) applyPhase(f, anim.out.type, Math.max(0, Math.min(1, (lengthMs - localMs) / outMs)), true);
  if (anim.loop === "pulse") f.scale *= 1 + 0.05 * Math.sin((2 * Math.PI * localMs) / 900);
  if (anim.loop === "wiggle") f.rotate += 5 * Math.sin((2 * Math.PI * localMs) / 500);
  return f;
}

/**
 * Style for the video layer around a clip-to-clip transition. Clips don't
 * overlap yet, so each transition is the outgoing clip leaving over the first
 * half and the incoming clip arriving over the second half.
 */
export function transitionStyle(cues: TransitionCue[], t: number): CSSProperties | undefined {
  const cue = cues.find((c) => Math.abs(t - c.atMs) < c.durationMs / 2);
  if (!cue) return undefined;
  const half = cue.durationMs / 2;
  const before = t < cue.atMs;
  const k = 1 - Math.abs(t - cue.atMs) / half; // 0 far from the cut → 1 at the cut
  const side = before ? -1 : 1;
  switch (cue.type) {
    case "fade":
      return { opacity: 1 - k };
    case "slide":
      return { transform: `translateX(${side * k * 100}%)` };
    case "wipe":
      return { clipPath: before ? `inset(0 ${k * 100}% 0 0)` : `inset(0 0 0 ${k * 100}%)` };
    case "zoom":
      return { transform: `scale(${1 + k * 0.4})`, opacity: 1 - k * 0.7 };
    case "whip":
      return { transform: `translateX(${side * k * 60}%)`, filter: `blur(${k * 24}px)` };
  }
}
