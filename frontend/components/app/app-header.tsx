"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ArrowUpRight, LogOut, Plus, Settings } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/site/layout-primitives";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass } from "./menu";

// The pathname is request data: keep the header itself static and let only the two
// path-aware links wait for it (Cache Components would otherwise block prerendering).
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <Container className="flex h-14 items-center gap-2 sm:h-16">
        <Logo href="/dashboard" />
        <nav aria-label="App" className="ml-4 flex items-center sm:ml-10">
          <Suspense fallback={<ProjectsLink active={false} />}>
            <PathAwareProjectsLink />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={null}>
            <PathAwareNewLink />
          </Suspense>
          <UserMenu />
        </div>
      </Container>
    </header>
  );
}

function ProjectsLink({ active }: { active: boolean }) {
  return (
    <Link
      href="/dashboard"
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full px-3.5 py-2 text-[15px] transition-colors focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none",
        active ? "bg-surface text-ink" : "text-ink-2 hover:text-ink",
      )}
    >
      Projects
    </Link>
  );
}

function PathAwareProjectsLink() {
  const pathname = usePathname();
  return <ProjectsLink active={pathname === "/dashboard" || pathname.startsWith("/projects")} />;
}

function PathAwareNewLink() {
  const pathname = usePathname();
  if (pathname === "/new") return null;
  return (
    <Link
      href="/new"
      className="hidden h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-medium text-white transition-colors hover:bg-ink-2 focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none sm:inline-flex"
    >
      <Plus className="size-4" aria-hidden />
      New video
    </Link>
  );
}

// Placeholder until auth lands: no real account yet.
function UserMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="grid size-9 place-items-center rounded-full bg-surface text-[13px] font-semibold text-ink-2 ring-1 ring-line transition-colors hover:bg-[#ebebef] focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none"
      >
        Y
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className={cn(menuContentClass, "w-60")}>
          <div className="px-3 pt-2 pb-2.5">
            <p className="text-sm font-medium text-ink">Your workspace</p>
            <p className="text-[13px] text-muted-foreground">Not signed in · local projects</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item disabled className={menuItemClass}>
            <Settings className="size-4" aria-hidden />
            Settings
            <span className="ml-auto text-xs text-muted-foreground">Soon</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={menuItemClass}>
            <Link href="/">
              <ArrowUpRight className="size-4" aria-hidden />
              Shortcraft website
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={menuItemClass}>
            <Link href="/login">
              <LogOut className="size-4" aria-hidden />
              Log in
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
