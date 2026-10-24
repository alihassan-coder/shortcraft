// Sound effects for SFX track items. Files live in /public/media/sfx/<id>.mp3
// (Mixkit, free license; added in E7). Until a file is checked in its entry
// stays `available: false`, and the renderer skips it instead of erroring.

export type Sfx = {
  id: string;
  name: string;
  durationMs: number;
  src: string;
  available: boolean;
};

const sfx = (id: string, name: string, durationMs: number, available = false): Sfx => ({
  id,
  name,
  durationMs,
  src: `/media/sfx/${id}.mp3`,
  available,
});

export const SFX: Sfx[] = [
  sfx("whoosh", "Whoosh", 800),
  sfx("pop", "Pop", 300),
  sfx("ding", "Ding", 900),
  sfx("click", "Click", 200),
  sfx("swoosh", "Swoosh", 700),
];

export const sfxById = (id: string) => SFX.find((s) => s.id === id) ?? null;
