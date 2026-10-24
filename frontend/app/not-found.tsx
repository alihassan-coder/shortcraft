import { Logo, LogoMark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/site/layout-primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
      <Logo />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <LogoMark className="h-14 w-10" />
        <p className="mt-10 font-mono text-sm text-muted-foreground">404 · 00:00:00:00</p>
        <h1 className="mt-3 text-[2.5rem] leading-tight font-semibold tracking-[-0.035em] md:text-h1">
          This page was cut.
        </h1>
        <p className="mt-4 max-w-md text-lg text-muted-foreground">
          The link may be old or mistyped. Let&apos;s get you back to the good part.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/" size="lg">
            Go home
          </ButtonLink>
          <ButtonLink href="/examples" variant="secondary" size="lg">
            See examples
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
