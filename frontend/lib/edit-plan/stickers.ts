// Pre-made stickers for element items ({ type: "sticker", stickerId }).
// Drawn by the renderer as a styled label; artwork can replace them later.

export type Sticker = { id: string; label: string; background: string; color: string };

export const STICKERS: Sticker[] = [
  { id: "subscribe", label: "SUBSCRIBE", background: "#ff0033", color: "#ffffff" },
  { id: "follow", label: "FOLLOW", background: "#111111", color: "#ffffff" },
  { id: "new", label: "NEW", background: "#facc15", color: "#111111" },
  { id: "link-in-bio", label: "LINK IN BIO", background: "#ffffff", color: "#111111" },
];

export const stickerById = (id: string) => STICKERS.find((s) => s.id === id) ?? null;
