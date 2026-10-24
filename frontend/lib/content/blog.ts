// Placeholder posts so the blog routes are real. Swap for a CMS later;
// pages only depend on getPosts() and getPost().

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readMinutes: number;
  category: "Guides" | "Product" | "Creators";
  cover: string;
  body: string[];
};

const POSTS: Post[] = [
  {
    slug: "first-three-seconds",
    title: "The first three seconds decide everything",
    excerpt: "Why most talking videos lose viewers before the first sentence ends, and the simple fix.",
    date: "2026-10-14",
    readMinutes: 5,
    category: "Guides",
    cover: "/media/clip-42323.jpg",
    body: [
      "People decide whether to keep watching almost instantly. If your video opens with a pause, a breath or “so, um”, most of them are already gone.",
      "Start with the most interesting sentence you say, not the first one. Then put a short title on screen that tells people what they will get.",
      "Shortcraft does both for you: it removes the slow start and suggests three hook titles you can choose from. You can always edit them.",
    ],
  },
  {
    slug: "captions-that-get-read",
    title: "How to style captions people actually read",
    excerpt: "Size, position and highlight colour matter more than the font. A practical guide.",
    date: "2026-09-30",
    readMinutes: 4,
    category: "Guides",
    cover: "/media/clip-42319.jpg",
    body: [
      "Most viewers watch with the sound off, so captions are your video. Keep them big, keep them in the middle of the screen, and keep lines short.",
      "Highlight one or two words per line, the ones that carry the meaning. Highlighting everything is the same as highlighting nothing.",
      "Keep captions above the bottom fifth of the screen, where TikTok and Reels put their buttons. Shortcraft shows those safe zones while you edit.",
    ],
  },
  {
    slug: "introducing-shortcraft",
    title: "Introducing Shortcraft",
    excerpt: "Raw phone video in, ready-to-post short out. Here's what we're building and why.",
    date: "2026-09-12",
    readMinutes: 3,
    category: "Product",
    cover: "/media/clip-2963.jpg",
    body: [
      "Recording a talking video takes two minutes. Editing it properly takes an hour. We think that hour should take one minute.",
      "Shortcraft reads what you said, removes the pauses and repeated takes, adds captions and zoom-ins, and picks music, then hands everything back to you to adjust.",
      "Nothing is locked in. Every edit is a suggestion you can change, and the video is only rendered when you export.",
    ],
  },
  {
    slug: "batch-a-week-of-videos",
    title: "Record a week of videos in one hour",
    excerpt: "A simple batching routine coaches use to post every day without burning out.",
    date: "2026-08-28",
    readMinutes: 6,
    category: "Creators",
    cover: "/media/clip-41290.jpg",
    body: [
      "Write seven one-sentence ideas. Record each one twice, back to back, without stopping the camera in between.",
      "Don’t worry about mistakes or pauses. That’s what editing is for, and Shortcraft keeps the better take automatically.",
      "Upload all seven, pick one style for the week, and export. Consistency beats perfection.",
    ],
  },
];

export function getPosts() {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string) {
  return POSTS.find((p) => p.slug === slug);
}

export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
