import type { CSSProperties } from "react";

// Caption style presets. Shared by the landing page showcase now and the
// editor + Remotion captions later, so keep this the single source of truth.

export type CaptionAnimation =
  | "pop"
  | "bounce"
  | "fade"
  | "slide"
  | "karaoke"
  | "typewriter";

export type CaptionEffect = "none" | "outline" | "shadow" | "box" | "glow" | "gradient";

export type CaptionPreset = {
  id: string;
  name: string;
  description: string;
  fontFamily: string;
  fontWeight: number;
  uppercase: boolean;
  color: string;
  highlightColor: string;
  effect: CaptionEffect;
  animation: CaptionAnimation;
  wordsPerLine: 1 | 2 | 3;
};

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "bold-pop",
    name: "Bold Pop",
    description: "Big, loud, yellow highlight",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#facc15",
    effect: "outline",
    animation: "pop",
    wordsPerLine: 2,
  },
  {
    id: "clean",
    name: "Clean",
    description: "Simple and calm",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 600,
    uppercase: false,
    color: "#ffffff",
    highlightColor: "#ffffff",
    effect: "shadow",
    animation: "fade",
    wordsPerLine: 3,
  },
  {
    id: "karaoke",
    name: "Karaoke",
    description: "Color fills word by word",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 800,
    uppercase: true,
    color: "rgba(255,255,255,0.55)",
    highlightColor: "#4ade80",
    effect: "shadow",
    animation: "karaoke",
    wordsPerLine: 3,
  },
  {
    id: "story",
    name: "Story",
    description: "Soft serif for storytelling",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontWeight: 500,
    uppercase: false,
    color: "#fff7ed",
    highlightColor: "#fdba74",
    effect: "shadow",
    animation: "fade",
    wordsPerLine: 3,
  },
  {
    id: "neon",
    name: "Neon",
    description: "Glowing, high energy",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 800,
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#22d3ee",
    effect: "glow",
    animation: "bounce",
    wordsPerLine: 2,
  },
  {
    id: "boxed",
    name: "Boxed",
    description: "Words on a color box",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 800,
    uppercase: false,
    color: "#ffffff",
    highlightColor: "#7c3aed",
    effect: "box",
    animation: "pop",
    wordsPerLine: 2,
  },
  {
    id: "beast",
    name: "Beast",
    description: "Thick outline, one word at a time",
    fontFamily: "Impact, 'Arial Black', sans-serif",
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#ef4444",
    effect: "outline",
    animation: "bounce",
    wordsPerLine: 1,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Small, lower third",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 500,
    uppercase: false,
    color: "#ffffff",
    highlightColor: "#ffffff",
    effect: "none",
    animation: "fade",
    wordsPerLine: 3,
  },
  {
    id: "gradient",
    name: "Gradient",
    description: "Colorful gradient words",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    highlightColor: "#f472b6",
    effect: "gradient",
    animation: "slide",
    wordsPerLine: 2,
  },
  {
    id: "typewriter",
    name: "Typewriter",
    description: "Letters type in",
    fontFamily: "var(--font-geist-mono)",
    fontWeight: 600,
    uppercase: false,
    color: "#ffffff",
    highlightColor: "#a3e635",
    effect: "box",
    animation: "typewriter",
    wordsPerLine: 3,
  },
  {
    id: "comic",
    name: "Comic",
    description: "Fun and playful",
    fontFamily: "'Comic Sans MS', 'Chalkboard SE', cursive",
    fontWeight: 800,
    uppercase: true,
    color: "#fde047",
    highlightColor: "#fb923c",
    effect: "outline",
    animation: "bounce",
    wordsPerLine: 2,
  },
  {
    id: "pro-subtle",
    name: "Pro Subtle",
    description: "Clean business look",
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 600,
    uppercase: false,
    color: "#ffffff",
    highlightColor: "#a78bfa",
    effect: "shadow",
    animation: "slide",
    wordsPerLine: 3,
  },
];

export function captionTextStyle(
  preset: CaptionPreset,
  highlighted: boolean,
): CSSProperties {
  const color = highlighted ? preset.highlightColor : preset.color;
  const style: CSSProperties = {
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    textTransform: preset.uppercase ? "uppercase" : "none",
    color,
  };

  switch (preset.effect) {
    case "outline":
      style.WebkitTextStroke = "0.12em #000";
      style.paintOrder = "stroke fill";
      break;
    case "shadow":
      style.textShadow = "0 2px 8px rgba(0,0,0,0.6)";
      break;
    case "glow":
      style.textShadow = `0 0 12px ${preset.highlightColor}, 0 0 2px ${preset.highlightColor}`;
      break;
    case "box":
      style.backgroundColor = highlighted ? preset.highlightColor : "rgba(0,0,0,0.65)";
      style.color = "#ffffff";
      style.padding = "0.05em 0.3em";
      style.borderRadius = "0.25em";
      break;
    case "gradient":
      style.backgroundImage = highlighted
        ? `linear-gradient(90deg, ${preset.highlightColor}, #facc15)`
        : "linear-gradient(90deg, #ffffff, #e9d5ff)";
      style.WebkitBackgroundClip = "text";
      style.color = "transparent";
      break;
  }

  return style;
}
