import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { FOOTER_NAV } from "@/lib/content/site";
import { Container } from "./layout-primitives";

export function SiteFooter() {
  return (
    <footer className="border-t bg-white">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
            Turn raw talking videos into ready-to-post shorts, right in your browser.
          </p>
        </div>
        {FOOTER_NAV.map((group) => (
          <div key={group.title}>
            <p className="text-sm font-medium">{group.title}</p>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition-colors hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="flex flex-wrap justify-between gap-3 border-t py-6 text-xs text-muted-foreground">
        <p>© 2026 Shortcraft</p>
        <p>Example footage from Mixkit</p>
      </Container>
    </footer>
  );
}
