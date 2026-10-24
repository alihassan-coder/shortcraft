import type { Metadata } from "next";
import {
  CaptionsDemo,
  CutsDemo,
  DemoStage,
  MusicDemo,
  PromptDemo,
  ZoomDemo,
} from "@/components/marketing/feature-demos";
import { FeatureRow } from "@/components/marketing/feature-row";
import { PhoneVideo } from "@/components/marketing/phone-video";
import { CtaBand } from "@/components/site/cta-band";
import { ButtonLink, Container, PageIntro, Section, SectionHeading } from "@/components/site/layout-primitives";
import { clipById } from "@/lib/demo-clips";

export const metadata: Metadata = {
  title: "Features",
  description: "Captions, cuts, zoom-ins, music, studio voice and hook titles, all editable in your browser.",
};

const JUMP = [
  { id: "captions", label: "Captions" },
  { id: "cuts", label: "Cuts" },
  { id: "zoom", label: "Zoom" },
  { id: "music", label: "Music" },
  { id: "hook", label: "Hook title" },
  { id: "describe", label: "Describe a change" },
];

const SMALL_THINGS = [
  ["Safe-zone guides", "See where TikTok and Reels buttons sit, so captions never hide under them."],
  ["Before / after", "Flip between your raw recording and the edit at any moment."],
  ["Undo everything", "Every change, yours or automatic, can be undone."],
  ["Keyboard shortcuts", "Space to play, J/K/L to scrub, arrows to move word by word."],
  ["Autosave", "Close the tab whenever. Your edit is right where you left it."],
  ["Export presets", "One click for TikTok, Reels or Shorts, sized correctly."],
  ["Studio voice", "Remove room echo and background hum from phone audio."],
  ["Words per line", "Show one, two or three words at a time, or the full line."],
];

export default function FeaturesPage() {
  return (
    <>
      <PageIntro
        title="Everything a talking video needs"
        lead="Shortcraft does the slow parts of editing for you, then hands every decision back to you."
      >
        <ButtonLink href="/signup" size="lg">
          Try it on your video
        </ButtonLink>
      </PageIntro>

      <nav aria-label="On this page" className="sticky top-16 z-40 border-y bg-white/85 backdrop-blur-xl">
        <Container className="flex gap-1 overflow-x-auto py-2.5 [scrollbar-width:none]">
          {JUMP.map((j) => (
            <a
              key={j.id}
              href={`#${j.id}`}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink"
            >
              {j.label}
            </a>
          ))}
        </Container>
      </nav>

      <Section>
        <div className="space-y-28 md:space-y-40">
          <FeatureRow
            id="captions"
            title="Captions people actually read"
            body="Each word appears as you say it. Important words are highlighted and emojis show up where they fit."
            points={["12 styles, switch in one click", "Fix any word by typing", "Drag captions up or down", "Save your own style"]}
            link={{ href: "/styles", label: "Browse all caption styles" }}
          >
            <DemoStage>
              <CaptionsDemo />
            </DemoStage>
          </FeatureRow>

          <FeatureRow
            id="cuts"
            flip
            title="Pauses, filler words and retakes, removed"
            body="Shortcraft reads what you said and takes out the dead air. If you said a line twice, it keeps the better take."
            points={["Choose what gets removed", "Click a word to bring it back", "Cut by deleting words in the text"]}
          >
            <DemoStage>
              <CutsDemo />
            </DemoStage>
          </FeatureRow>

          <FeatureRow
            id="zoom"
            title="Zoom-ins that keep one shot moving"
            body="Gentle push-ins and quick punch-ins on the moments that matter, centred on your face."
            points={["Four zoom styles", "Set how strong each zoom is", "Move, add or remove on the timeline"]}
          >
            <DemoStage>
              <ZoomDemo />
            </DemoStage>
          </FeatureRow>

          <FeatureRow
            id="music"
            flip
            title="Music that steps back when you speak"
            body="Pick a royalty-free track or let Shortcraft match one to the mood. It lowers automatically under your voice."
            points={["Safe for TikTok, Reels and Shorts", "Fade in and out", "Volume control"]}
          >
            <DemoStage>
              <MusicDemo />
            </DemoStage>
          </FeatureRow>

          <FeatureRow
            id="hook"
            title="A hook title for the first three seconds"
            body="Shortcraft suggests three short titles based on what you said. Pick one, edit it, or write your own."
            points={["Three suggestions per video", "Its own style and timing", "Edit like any caption"]}
          >
            <DemoStage>
              <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
                <div className="mx-auto w-full max-w-[200px]">
                  <PhoneVideo clip={clipById("39813")} captions={false} zoom={false} />
                </div>
                <div className="space-y-2">
                  {["I almost quit. Here's why", "The day everything changed", "Nobody tells you this part"].map(
                    (h, i) => (
                      <div
                        key={h}
                        className={`rounded-2xl border bg-white px-4 py-3.5 text-[15px] ${i === 0 ? "border-ink" : ""}`}
                      >
                        {h}
                        {i === 0 && <span className="ml-2 text-xs text-muted-foreground">Selected</span>}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </DemoStage>
          </FeatureRow>

          <FeatureRow
            id="describe"
            flip
            title="Describe a change in plain words"
            body="Ask for “more energy” or “cut the part about pricing”. Shortcraft shows exactly what it changed, and one click undoes it."
            points={["Works on the whole video", "Shows every change", "One-click undo"]}
          >
            <DemoStage>
              <PromptDemo />
            </DemoStage>
          </FeatureRow>
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeading title="And the small things that save time" />
        <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {SMALL_THINGS.map(([t, d]) => (
            <div key={t}>
              <dt className="font-medium">{t}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <CtaBand />
    </>
  );
}
