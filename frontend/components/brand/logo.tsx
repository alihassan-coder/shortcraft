import Link from "next/link";
import { cn } from "@/lib/utils";

// The mark: a 9:16 frame (a "short") split by a single diagonal cut.
// Top half ink, bottom half Rec orange. Holds up down to 16px.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 28" className={cn("h-7 w-5", className)} aria-hidden>
      <path d="M4 0h12a4 4 0 0 1 4 4v7.2L0 16.6V4a4 4 0 0 1 4-4Z" className="fill-ink" />
      <path d="M20 14.4V24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4v-4.2l20-5.4Z" className="fill-rec" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)} aria-label="Shortcraft home">
      <LogoMark className="h-6 w-[17px]" />
      <span className="text-[19px] font-semibold tracking-[-0.02em] text-ink">Shortcraft</span>
    </Link>
  );
}
