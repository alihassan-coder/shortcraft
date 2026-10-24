import type { Metadata } from "next";
import { ExamplesGallery } from "@/components/marketing/examples-gallery";
import { CtaBand } from "@/components/site/cta-band";
import { Container, PageIntro } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Examples",
  description: "See raw talking videos next to their Shortcraft edits.",
};

export default function ExamplesPage() {
  return (
    <>
      <PageIntro
        title="Examples"
        lead="Real recordings, edited with Shortcraft. Open any video to compare it with the raw take."
      />
      <Container className="pb-8">
        <ExamplesGallery />
      </Container>
      <CtaBand title="Want to see yours like this?" />
    </>
  );
}
