import { LogoMark } from "@/components/brand/logo";
import { ButtonLink, Container } from "./layout-primitives";

export function CtaBand({
  title = "Your next short is already on your phone.",
  lead = "Upload it and see the edit in about a minute. Free for 5 videos a month.",
}: {
  title?: string;
  lead?: string;
}) {
  return (
    <section className="py-24 md:py-32">
      <Container>
        <div className="flex flex-col items-center rounded-[28px] bg-surface px-6 py-20 text-center md:py-24">
          <LogoMark className="h-10 w-7" />
          <h2 className="mt-8 max-w-2xl text-[2rem] leading-tight font-semibold tracking-[-0.03em] md:text-h2">
            {title}
          </h2>
          <p className="mt-4 max-w-lg text-lg text-muted-foreground">{lead}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" size="lg">
              Start for free
            </ButtonLink>
            <ButtonLink href="/examples" variant="ghost" size="lg">
              See examples
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
