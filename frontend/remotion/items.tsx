import type { CSSProperties } from "react";
import { Img } from "remotion";
import { stickerById } from "@/lib/edit-plan/stickers";
import type { Element, ElementItem, ImageItem, TextItem, VisualItem } from "@/lib/edit-plan/schema";
import { animate, type AnimFrame } from "./animate";

// Track items on the canvas: text, elements (emoji / shapes / stickers) and images.
// Sizes are in canvas pixels (the composition is rendered at canvas resolution).

type Size = { width: number; height: number };

export function ItemLayer({ item, t, canvas }: { item: VisualItem; t: number; canvas: Size }) {
  const a = animate(item.animation, t - item.startMs, item.endMs - item.startMs);
  const tr = item.transform;
  return (
    <div
      data-item={item.id}
      style={{
        position: "absolute",
        left: `${tr.x * 100}%`,
        top: `${tr.y * 100}%`,
        transform: `translate(-50%, -50%) translate(${a.dx * canvas.width}px, ${a.dy * canvas.height}px) rotate(${tr.rotation + a.rotate}deg) scale(${tr.scale * a.scale})`,
        opacity: tr.opacity * a.opacity,
        pointerEvents: "none",
      }}
    >
      {item.kind === "text" && <TextContent item={item} frame={a} canvas={canvas} />}
      {item.kind === "element" && <ElementContent item={item} canvas={canvas} />}
      {item.kind === "image" && <ImageContent item={item} canvas={canvas} />}
    </div>
  );
}

/** "#RRGGBB(AA)" × opacity → rgba(). */
export function withAlpha(hex: string, opacity = 1) {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  const a = hex.length === 9 ? n(7) / 255 : 1;
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${+(a * opacity).toFixed(3)})`;
}

const CASE: Record<TextItem["style"]["case"], CSSProperties["textTransform"]> = {
  none: "none",
  upper: "uppercase",
  lower: "lowercase",
  title: "capitalize",
};

export function textItemStyle(s: TextItem["style"]): CSSProperties {
  const style: CSSProperties = {
    display: "inline-block",
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    fontStyle: s.italic ? "italic" : "normal",
    fontSize: s.size,
    letterSpacing: `${s.letterSpacing}em`,
    lineHeight: s.lineHeight,
    textAlign: s.align,
    textTransform: CASE[s.case],
    color: s.color,
    whiteSpace: "pre-wrap",
  };
  if (s.gradient) {
    style.backgroundImage = `linear-gradient(${s.gradient.angle}deg, ${s.gradient.from}, ${s.gradient.to})`;
    style.WebkitBackgroundClip = "text";
    style.backgroundClip = "text";
    style.color = "transparent";
  }
  if (s.stroke && s.stroke.width > 0) {
    style.WebkitTextStroke = `${s.stroke.width}px ${s.stroke.color}`;
    style.paintOrder = "stroke fill";
  }
  if (s.shadow) {
    const { x, y, blur, color } = s.shadow;
    // text-shadow shows through transparent (gradient) text, so use a filter there.
    if (s.gradient) style.filter = `drop-shadow(${x}px ${y}px ${blur / 2}px ${color})`;
    else style.textShadow = `${x}px ${y}px ${blur}px ${color}`;
  }
  return style;
}

function TextContent({ item, frame, canvas }: { item: TextItem; frame: AnimFrame; canvas: Size }) {
  const s = item.style;
  const text = frame.reveal < 1 ? item.text.slice(0, Math.ceil(frame.reveal * item.text.length)) : item.text;
  const box = s.background;
  return (
    <div
      style={{
        width: "max-content",
        maxWidth: canvas.width * 0.9,
        textAlign: s.align,
        ...(box ? { backgroundColor: withAlpha(box.color, box.opacity), padding: box.padding, borderRadius: box.radius } : {}),
      }}
    >
      <span style={textItemStyle(s)}>{text}</span>
    </div>
  );
}

function ElementContent({ item, canvas }: { item: ElementItem; canvas: Size }) {
  const e = item.element;
  switch (e.type) {
    case "emoji":
      return <span style={{ display: "block", fontSize: canvas.width * 0.15, lineHeight: 1 }}>{e.emoji}</span>;
    case "shape":
      return <Shape shape={e} canvas={canvas} />;
    case "sticker": {
      const s = stickerById(e.stickerId);
      if (!s) return null;
      return (
        <span
          style={{
            display: "block",
            padding: `${canvas.width * 0.015}px ${canvas.width * 0.035}px`,
            borderRadius: canvas.width * 0.02,
            background: s.background,
            color: s.color,
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 900,
            fontSize: canvas.width * 0.055,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(0,0,0,.25)",
          }}
        >
          {s.label}
        </span>
      );
    }
  }
}

function Shape({ shape: s, canvas }: { shape: Extract<Element, { type: "shape" }>; canvas: Size }) {
  const w = s.width * canvas.width;
  const h = s.height * canvas.width;
  const sw = s.strokeWidth;
  const line = Math.max(sw, 2);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      {s.shape === "rect" && <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} fill={s.fill} stroke={s.stroke} strokeWidth={sw} />}
      {s.shape === "circle" && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, (w - sw) / 2)} ry={Math.max(0, (h - sw) / 2)} fill={s.fill} stroke={s.stroke} strokeWidth={sw} />}
      {s.shape === "line" && <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={s.stroke} strokeWidth={line} strokeLinecap="round" />}
      {s.shape === "arrow" && (
        <>
          <line x1={0} y1={h / 2} x2={w - line * 3} y2={h / 2} stroke={s.stroke} strokeWidth={line} strokeLinecap="round" />
          <polygon points={`${w},${h / 2} ${w - line * 4},${h / 2 - line * 2.5} ${w - line * 4},${h / 2 + line * 2.5}`} fill={s.stroke} />
        </>
      )}
    </svg>
  );
}

function ImageContent({ item, canvas }: { item: ImageItem; canvas: Size }) {
  if (!item.src) return null;
  return <Img src={item.src} style={{ display: "block", width: item.width * canvas.width }} />;
}
