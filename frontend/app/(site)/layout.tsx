import { Suspense } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

// The header reads the current path (active nav link), which is request data,
// so it streams in behind Suspense instead of blocking prerendered pages.
function HeaderFallback() {
  return <div className="h-16 border-b border-transparent" aria-hidden />;
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<HeaderFallback />}>
        <SiteHeader />
      </Suspense>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
