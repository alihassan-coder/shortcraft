import type { Metadata } from "next";
import Image from "next/image";
import { CtaBand } from "@/components/site/cta-band";
import { Container, PageIntro, Section, SectionHeading } from "@/components/site/layout-primitives";
import { clipById } from "@/lib/demo-clips";

export const metadata: Metadata = {
  title: "About",
  description: "Why we're building Shortcraft.",
};

const PRINCIPLES = [
  {
    title: "You stay the editor",
    body: "Shortcraft suggests every edit and you can change any of them. Nothing is locked in until you export.",
  },
  {
    title: "Fast is a feature",
    body: "The first edit should be ready before you've finished your coffee. Changes should feel instant.",
  },
  {
    title: "No timeline degree needed",
    body: "If you can type and drag, you can use Shortcraft. Pro controls are there when you want them.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro
        title="Recording takes two minutes. Editing shouldn't take an hour."
        lead="We're building the fastest way to turn a raw talking video into something you're proud to post."
      />

      <Container>
        <div className="grid grid-cols-3 gap-3 md:gap-5">
          {["42316", "41290", "34487"].map((id, i) => (
            <div key={id} className={`relative aspect-[3/4] overflow-hidden rounded-[20px] bg-surface ${i === 1 ? "md:translate-y-10" : ""}`}>
              <Image src={clipById(id).poster} alt="" fill sizes="33vw" className="object-cover" />
            </div>
          ))}
        </div>
      </Container>

      <Section>
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-20">
          <SectionHeading title="Why Shortcraft" />
          <div className="space-y-6 text-lg leading-relaxed text-ink-2">
            <p>
              Short videos are how people find coaches, creators and small businesses now. Recording one is easy.
              Making it look good is not: captions, cuts, zooms and music take time and skill most people don’t
              have.
            </p>
            <p>
              Shortcraft reads your video the way an editor would. It finds the pauses, the repeated lines and the
              moments worth a zoom, then builds a complete edit you can watch straight away.
            </p>
            <p>Then it gets out of the way, so you can make it yours.</p>
          </div>
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeading title="What we believe" />
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="border-t border-ink/15 pt-6">
              <h3 className="text-h3">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
