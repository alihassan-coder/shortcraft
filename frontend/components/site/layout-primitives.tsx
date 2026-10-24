import Link from "next/link";
import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1160px] px-5 sm:px-8", className)}>{children}</div>;
}

export function Section({
  id,
  tone = "default",
  className,
  children,
}: {
  id?: string;
  tone?: "default" | "surface" | "ink";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 py-24 md:py-32",
        tone === "surface" && "bg-surface",
        tone === "ink" && "bg-ink text-white",
        className,
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  title,
  lead,
  align = "left",
  className,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <h2 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em] md:text-h2">{title}</h2>
      {lead && <p className="mt-4 text-lg text-muted-foreground md:text-lead">{lead}</p>}
    </div>
  );
}

// Title block at the top of every inner page.
export function PageIntro({
  title,
  lead,
  children,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="pt-20 pb-14 md:pt-28 md:pb-20">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] md:text-h1">{title}</h1>
          {lead && <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground md:text-lead">{lead}</p>}
          {children && <div className="mt-8">{children}</div>}
        </div>
      </Container>
    </header>
  );
}

type ButtonLinkProps = {
  href: string;
  variant?: "primary" | "secondary" | "accent" | "ghost";
  size?: "md" | "lg";
  className?: string;
  children: React.ReactNode;
};

export function buttonLinkClass({
  variant = "primary",
  size = "md",
  className,
}: Omit<ButtonLinkProps, "href" | "children">) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none",
    size === "md" ? "h-10 px-5 text-[15px]" : "h-12 px-7 text-base",
    variant === "primary" && "bg-ink text-white hover:bg-ink-2",
    variant === "secondary" && "bg-surface text-ink hover:bg-[#ebebef]",
    variant === "accent" && "bg-rec text-white hover:bg-[#f04e12]",
    variant === "ghost" && "text-ink hover:bg-surface",
    className,
  );
}

export function ButtonLink({ href, variant, size, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonLinkClass({ variant, size, className })}>
      {children}
    </Link>
  );
}
