// Royalty-free tracks from Mixkit (Mixkit Free Music License: free for
// commercial use, no attribution required). Trimmed to 40s in /public/media/music.

export type Track = {
  id: string;
  name: string;
  mood: "Upbeat" | "Calm" | "Dramatic" | "Inspiring";
  src: string;
  sourceUrl: string;
};

export const TRACKS: Track[] = [
  { id: "summer-fun", name: "Summer Fun", mood: "Upbeat", src: "/media/music/mixkit-724.mp3", sourceUrl: "https://mixkit.co/free-stock-music/" },
  { id: "just-chill", name: "Just Chill", mood: "Calm", src: "/media/music/mixkit-25.mp3", sourceUrl: "https://mixkit.co/free-stock-music/" },
  { id: "forest-walk", name: "Forest Walk", mood: "Calm", src: "/media/music/mixkit-846.mp3", sourceUrl: "https://mixkit.co/free-stock-music/" },
  { id: "epic-drums", name: "Epic Drums", mood: "Dramatic", src: "/media/music/mixkit-184.mp3", sourceUrl: "https://mixkit.co/free-stock-music/" },
  { id: "a-new-life", name: "A New Life", mood: "Inspiring", src: "/media/music/mixkit-613.mp3", sourceUrl: "https://mixkit.co/free-stock-music/" },
];

export const trackById = (id: string | null) => TRACKS.find((t) => t.id === id) ?? null;
