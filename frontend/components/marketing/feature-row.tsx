import Link from "next/link";
import { cn } from "@/lib/utils";

export function FeatureRow({
  id,
  title,
  body,
  points,
  link,
  flip,
  children,
}: {
  id?: string;
  title: string;
  body: string;
  points?: string[];
  link?: { href: string; label: string };
  flip?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="grid scroll-mt-28 items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
      <div className={cn("max-w-md", flip && "lg:order-last")}>
        <h3 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] md:text-[2rem]">{title}</h3>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{body}</p>
        {points && (
          <ul className="mt-6 space-y-2.5 text-[15px] text-ink-2">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <svg viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-rec" fill="none" aria-hidden>
                  <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
        )}
        {link && (
          <Link href={link.href} className="mt-7 inline-block text-[15px] font-medium text-ink underline decoration-line underline-offset-[6px] transition-colors hover:decoration-ink">
            {link.label}
          </Link>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
