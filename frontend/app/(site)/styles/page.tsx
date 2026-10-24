import type { Metadata } from "next";
import { StylesGallery } from "@/components/marketing/styles-gallery";
import { CtaBand } from "@/components/site/cta-band";
import { Container, PageIntro } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Caption styles",
  description: "12 animated caption styles for talking videos. Preview each one live.",
};

export default function StylesPage() {
  return (
    <>
      <PageIntro
        title="Caption styles"
        lead="Twelve styles, each animated word by word. Pick one to preview it on a real video."
      />
      <Container className="pb-8">
        <StylesGallery />
      </Container>
      <CtaBand title="Pick a style. Upload a video. Done." />
    </>
  );
}
