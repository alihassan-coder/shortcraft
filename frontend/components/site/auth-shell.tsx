import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { BeforeAfter } from "@/components/marketing/before-after";
import { clipById } from "@/lib/demo-clips";

// Split layout shared by /login and /signup: form on the left, product on the right.
export function AuthShell({
  title,
  lead,
  footer,
  children,
}: {
  title: string;
  lead: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-16">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-2 text-muted-foreground">{lead}</p>
          <div className="mt-9">{children}</div>
          <p className="mt-8 text-center text-sm text-muted-foreground">{footer}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link href="/about" className="underline underline-offset-2">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/about" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
      <div className="hidden items-center justify-center bg-surface p-12 lg:flex">
        <div className="w-full max-w-[300px]">
          <BeforeAfter clip={clipById("42319")} />
          <p className="mt-6 text-center text-[15px] text-muted-foreground">
            Drag to see what Shortcraft does to a raw recording.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthDivider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function GoogleButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-12 w-full items-center justify-center gap-3 rounded-full border text-[15px] font-medium transition-colors hover:bg-surface"
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
      </svg>
      {label}
    </button>
  );
}

export const fieldClass =
  "h-12 w-full rounded-xl border bg-white px-4 text-[15px] outline-none transition placeholder:text-muted-foreground/70 focus:border-ink focus:ring-3 focus:ring-rec/20";
