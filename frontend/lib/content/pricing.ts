export type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  monthly: number;
  yearly: number;
  description: string;
  cta: string;
  featured?: boolean;
  highlights: string[];
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
    description: "Everything you need to try Shortcraft properly.",
    cta: "Start for free",
    highlights: [
      "5 videos a month",
      "Up to 3 minutes per video",
      "All 12 caption styles",
      "Auto cuts and zoom-ins",
      "720p export with a small watermark",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 15,
    yearly: 12,
    description: "For creators who post every week.",
    cta: "Start 7-day trial",
    featured: true,
    highlights: [
      "30 videos a month",
      "1080p, no watermark",
      "Music library and hook titles",
      "Edit by describing changes",
      "Save your own caption styles",
    ],
  },
  {
    id: "business",
    name: "Business",
    monthly: 35,
    yearly: 28,
    description: "For teams and brands posting at volume.",
    cta: "Start 7-day trial",
    highlights: ["100 videos a month", "4K export", "Brand kit", "Stock B-roll", "Priority rendering"],
  },
];

type Cell = boolean | string;
export const COMPARE: { group: string; rows: { label: string; values: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "Usage",
    rows: [
      { label: "Videos per month", values: ["5", "30", "100"] },
      { label: "Max video length", values: ["3 min", "3 min", "5 min"] },
      { label: "Export quality", values: ["720p", "1080p", "4K"] },
      { label: "Watermark", values: ["Small", false, false] },
      { label: "Project storage", values: ["7 days", "90 days", "1 year"] },
    ],
  },
  {
    group: "Editing",
    rows: [
      { label: "Animated captions (12 styles)", values: [true, true, true] },
      { label: "Remove pauses, filler words, retakes", values: [true, true, true] },
      { label: "Auto zoom-ins", values: [true, true, true] },
      { label: "Edit by deleting text", values: [true, true, true] },
      { label: "Music library with ducking", values: [false, true, true] },
      { label: "Hook titles", values: [false, true, true] },
      { label: "Describe a change in plain words", values: [false, true, true] },
      { label: "Studio voice", values: [false, true, true] },
      { label: "Custom caption styles", values: [false, true, true] },
    ],
  },
  {
    group: "Brand & team",
    rows: [
      { label: "Brand kit (fonts, colours, logo)", values: [false, false, true] },
      { label: "Stock B-roll", values: [false, false, true] },
      { label: "Priority rendering", values: [false, false, true] },
    ],
  },
];
