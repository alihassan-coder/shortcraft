// Demo clips for the landing page: free stock footage from Mixkit
// (Mixkit Stock Video Free License — commercial use, no attribution required),
// trimmed to 8s 9:16 loops in /public/media. Replace with real customer edits later.

export type DemoClip = {
  id: string;
  src: string;
  poster: string;
  category: string;
  hook: string;
  presetId: string;
};

const clip = (id: string) => ({ id, src: `/media/clip-${id}.mp4`, poster: `/media/clip-${id}.jpg` });

export const DEMO_CLIPS: DemoClip[] = [
  { ...clip("42323"), category: "Creator tips", hook: "Stop posting like this ❌", presetId: "bold-pop" },
  { ...clip("2963"), category: "Podcast", hook: "The advice nobody gives you", presetId: "karaoke" },
  { ...clip("42319"), category: "Lifestyle", hook: "My 5am routine changed everything", presetId: "comic" },
  { ...clip("39813"), category: "Storytime", hook: "I almost quit. Here's why", presetId: "story" },
  { ...clip("41290"), category: "Coaching", hook: "3 habits of calm people", presetId: "pro-subtle" },
  { ...clip("34487"), category: "Travel vlog", hook: "Don't visit before watching", presetId: "boxed" },
  { ...clip("42316"), category: "Behind the scenes", hook: "How I film with $50", presetId: "neon" },
  { ...clip("43573"), category: "Beauty", hook: "This look takes 2 minutes", presetId: "gradient" },
];

export const clipById = (id: string) => DEMO_CLIPS.find((c) => c.id === id) ?? DEMO_CLIPS[0];
