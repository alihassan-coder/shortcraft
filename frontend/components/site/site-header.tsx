"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MAIN_NAV } from "@/lib/content/site";
import { cn } from "@/lib/utils";
import { ButtonLink, Container } from "./layout-primitives";

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-white/80 backdrop-blur-xl backdrop-saturate-150 transition-shadow",
        scrolled && "shadow-[0_1px_0_0_var(--border)]",
      )}
    >
      <Container className="flex h-16 items-center">
        <Logo />
        <nav className="ml-12 hidden items-center gap-1 md:flex" aria-label="Main">
          {MAIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-2 text-[15px] transition-colors",
                isActive(item.href) ? "bg-surface text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <ButtonLink href="/login" variant="ghost">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup">Start for free</ButtonLink>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            className="ml-auto grid size-10 place-items-center rounded-full hover:bg-surface md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] gap-0 p-0">
            <SheetTitle className="border-b px-5 py-4">
              <Logo />
            </SheetTitle>
            <nav className="flex flex-col p-3" aria-label="Mobile">
              {[...MAIN_NAV, { label: "About", href: "/about" }, { label: "Blog", href: "/blog" }].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-xl px-3 py-3 text-[17px]",
                    isActive(item.href) ? "bg-surface font-medium" : "hover:bg-surface",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto grid gap-2 border-t p-5">
              <ButtonLink href="/signup" size="lg">
                Start for free
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="lg">
                Log in
              </ButtonLink>
            </div>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}
