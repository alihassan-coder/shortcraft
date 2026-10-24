import Link from "next/link";
import { CaptionsDemo, CutsDemo, DemoStage, PromptDemo } from "@/components/marketing/feature-demos";
import { FaqList } from "@/components/marketing/faq-list";
import { FeatureRow } from "@/components/marketing/feature-row";
import { HomeHero } from "@/components/marketing/home-hero";
import { PhoneVideo } from "@/components/marketing/phone-video";
import { CtaBand } from "@/components/site/cta-band";
import { ButtonLink, Container, Section, SectionHeading } from "@/components/site/layout-primitives";
import { GENERAL_FAQ } from "@/lib/content/faq";
import { DEMO_CLIPS } from "@/lib/demo-clips";

const STEPS = [
  { title: "Record", body: "Talk to your phone camera. Mistakes and pauses are fine, keep going." },
  { title: "Upload", body: "Drop the video in. In about a minute you get a full edit to watch." },
  { title: "Fine-tune and export", body: "Change any word, style, zoom or song. Export for TikTok, Reels or Shorts." },
];

const PLATFORMS = ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "Facebook Reels"];

export default function HomePage() {
  return (
    <>
      <HomeHero />

      <Container className="pb-8">
        <div className="flex flex-col items-center gap-5 border-y py-8 md:flex-row md:justify-between">
          <p className="text-sm text-muted-foreground">Exports sized and safe-zoned for</p>
          <ul className="flex flex-wrap justify-center gap-x-10 gap-y-2 text-[17px] font-semibold tracking-[-0.01em] text-ink-2">
            {PLATFORMS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </Container>

      <Section>
        <SectionHeading title="From phone to posted in three steps" />
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t pt-6">
              <span className="font-mono text-sm text-rec">0{i + 1}</span>
              <h3 className="mt-3 text-h3">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="surface" className="!py-0">
        <div className="space-y-28 py-24 md:space-y-36 md:py-32">
          <FeatureRow
            title="Captions people actually read"
            body="Each word appears as you say it. Key words are highlighted and emojis land where they fit. Pick one of 12 styles and switch any time."
            points={["Fix any word by typing", "Move captions up or down", "Save your own style"]}
            link={{ href: "/styles", label: "Browse all caption styles" }}
          >
            <DemoStage className="bg-white">
              <CaptionsDemo />
            </DemoStage>
          </FeatureRow>
          <FeatureRow
            flip
            title="The pauses and “um”s are already gone"
            body="Long pauses, filler words and lines you said twice are taken out. Nothing is lost: click a word to bring it back."
            points={["Choose what gets removed", "Keeps your better take", "Cut by deleting text"]}
            link={{ href: "/features#cuts", label: "More about cutting" }}
          >
            <DemoStage className="bg-white">
              <CutsDemo />
            </DemoStage>
          </FeatureRow>
          <FeatureRow
            title="Or just describe the change"
            body="Not sure which setting to touch? Say what you want in plain words. You see exactly what changed, and you can undo it."
            link={{ href: "/features", label: "See every feature" }}
          >
            <DemoStage className="bg-white">
              <PromptDemo />
            </DemoStage>
          </FeatureRow>
        </div>
      </Section>

      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            title="Works for any video where you talk to the camera"
            lead="Tips, podcasts, storytimes, coaching and vlogs, each with a style that fits."
          />
          <ButtonLink href="/examples" variant="secondary">
            View all examples
          </ButtonLink>
        </div>
        <ul className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-4">
          {DEMO_CLIPS.slice(0, 4).map((clip) => (
            <li key={clip.id}>
              <Link href="/examples" className="group block">
                <div className="transition-transform duration-300 group-hover:-translate-y-1">
                  <PhoneVideo clip={clip} captionSize={16} zoom={false} />
                </div>
                <p className="mt-3 text-[15px] font-medium">{clip.category}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Container>
        <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] border p-8 md:flex-row md:items-center md:p-10">
          <div>
            <p className="text-h3">Free for 5 videos a month.</p>
            <p className="mt-1 text-lg text-muted-foreground">Pro from $12 a month when you post more.</p>
          </div>
          <ButtonLink href="/pricing" size="lg">
            See pricing
          </ButtonLink>
        </div>
      </Container>

      <Section>
        <FaqList items={GENERAL_FAQ} />
      </Section>

      <CtaBand />
    </>
  );
}
