import { CAPTION_PRESETS, type CaptionPreset } from "@/lib/caption-presets";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "./schema";

// Text item styles. A preset is a starting point: picking one writes a full
// TextStyle into the item, and the user can change any field afterwards.

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Geist", value: "var(--font-geist-sans), system-ui, sans-serif" },
  { label: "Instrument", value: "var(--font-instrument), system-ui, sans-serif" },
  { label: "Mono", value: "var(--font-geist-mono), ui-monospace, monospace" },
  { label: "Impact", value: "Impact, 'Arial Black', sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Comic", value: "'Comic Sans MS', 'Chalkboard SE', cursive" },
];

/** CSS color (hex or rgba()) → "#RRGGBB" / "#RRGGBBAA". Unknown formats fall back. */
export function toHexColor(css: string, fallback = "#ffffff"): string {
  const c = css.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split("").map((x) => x + x).join("")}`.toLowerCase();
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return fallback;
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  const alpha = m[4] === undefined ? "" : hex(Number(m[4]) * 255);
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${alpha === "ff" ? "" : alpha}`;
}

/** Full text style that looks like a caption preset (same look v2 text overlays had). */
export function presetTextStyle(preset: CaptionPreset, size = DEFAULT_TEXT_STYLE.size): TextStyle {
  const style: TextStyle = {
    ...DEFAULT_TEXT_STYLE,
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    size,
    case: preset.uppercase ? "upper" : "none",
    color: toHexColor(preset.color),
  };
  switch (preset.effect) {
    case "outline":
      style.stroke = { color: "#000000", width: Math.round(size * 0.12) };
      break;
    case "shadow":
      style.shadow = { color: "#00000099", blur: 8, x: 0, y: 2 };
      break;
    case "glow":
      style.shadow = { color: toHexColor(preset.highlightColor), blur: 12, x: 0, y: 0 };
      break;
    case "box":
      style.color = "#ffffff";
      style.background = { color: "#000000", opacity: 0.65, padding: Math.round(size * 0.3), radius: Math.round(size * 0.25) };
      break;
    case "gradient":
      style.gradient = { from: "#ffffff", to: "#e9d5ff", angle: 90 };
      break;
  }
  return style;
}

export function presetById(id: string | undefined): CaptionPreset {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];
}
