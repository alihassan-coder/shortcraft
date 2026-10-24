"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ArrowDownUp, Check, Plus, Search, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { apiBaseUrl, isApiError, projects as projectsApi, type Project } from "@/lib/api";
import { projectIndex } from "@/lib/upload/project-index";
import { setPendingFile } from "@/lib/upload/pending-file";
import { Container } from "@/components/site/layout-primitives";
import { VideoDropzone } from "./dropzone";
import { useProjectIndex, usePolling } from "./hooks";
import { menuContentClass, menuItemClass } from "./menu";
import { ProjectCard } from "./project-card";
import { DeleteProjectDialog, RenameProjectDialog, pillButton } from "./project-dialogs";

type Sort = "updated" | "created" | "title";
const SORTS: { id: Sort; label: string }[] = [
  { id: "updated", label: "Last edited" },
  { id: "created", label: "Date created" },
  { id: "title", label: "Name" },
];

export function Dashboard() {
  const router = useRouter();
  const local = useProjectIndex();
  const { data, error, loading, refresh } = usePolling("projects", (signal) => projectsApi.list({ signal, limit: 200 }));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  // Optimistic edits on top of the last list.
  const [overrides, setOverrides] = useState<Record<string, Project | null>>({});

  const list = useMemo(() => {
    const all = (data ?? []).map((p) => (p.id in overrides ? overrides[p.id] : p)).filter((p): p is Project => !!p);
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((p) => p.title.toLowerCase().includes(q)) : all;
    return [...filtered].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : (sort === "created" ? b.created_at : b.updated_at).localeCompare(sort === "created" ? a.created_at : a.updated_at),
    );
  }, [data, overrides, query, sort]);

  const startWith = (file: File) => {
    setPendingFile(file);
    router.push("/new");
  };

  const unreachable = !data && error;
  const total = data ? data.filter((p) => overrides[p.id] !== null).length : 0;

  return (
    <Container className="py-10 sm:py-14">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em] sm:text-[2.5rem]">Projects</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {data ? (total === 1 ? "1 video" : `${total} videos`) : "Your videos and their edits."}
          </p>
        </div>
        {!!total && (
          // The header has this button from sm up.
          <Link href="/new" className={`${pillButton("primary")} sm:hidden`}>
            <Plus className="size-4" aria-hidden />
            New video
          </Link>
        )}
      </div>

      {unreachable ? (
        <ServerDown error={error} onRetry={refresh} />
      ) : loading && !data ? (
        <GridSkeleton />
      ) : total === 0 ? (
        <div className="mt-10">
          <VideoDropzone onFile={startWith} title="Drop your first video here" />
          <p className="mt-5 text-center text-[15px] text-muted-foreground">
            Want to look around first?{" "}
            <Link href="/editor/demo" className="font-medium text-ink underline underline-offset-4">
              Open the demo editor
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 flex items-center gap-2">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <label htmlFor="project-search" className="sr-only">
                Search projects
              </label>
              <input
                id="project-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                className="h-10 w-full rounded-full border border-line bg-white pr-4 pl-10 text-[15px] outline-none placeholder:text-muted-foreground focus:border-rec focus:ring-3 focus:ring-rec/20"
              />
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className={`${pillButton("ghost")} ml-auto h-10 px-3.5 text-[14px] text-ink-2 data-[state=open]:bg-surface`}>
                <ArrowDownUp className="size-4" aria-hidden />
                <span className="hidden sm:inline">{SORTS.find((s) => s.id === sort)?.label}</span>
                <span className="sr-only sm:hidden">Sort</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className={menuContentClass}>
                  <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">Sort by</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                    {SORTS.map((s) => (
                      <DropdownMenu.RadioItem key={s.id} value={s.id} className={menuItemClass}>
                        {s.label}
                        <DropdownMenu.ItemIndicator className="ml-auto">
                          <Check className="size-4" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          {list.length === 0 ? (
            <p className="mt-16 text-center text-[15px] text-muted-foreground">No projects match “{query}”.</p>
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
              {list.map((project) => (
                <li key={project.id}>
                  <ProjectCard
                    project={project}
                    local={local[project.id]}
                    onRename={() => setRenaming(project)}
                    onDelete={() => setDeleting(project)}
                  />
                </li>
              ))}
            </ul>
          )}
          {error != null && (
            <p role="status" className="mt-8 text-center text-sm text-muted-foreground">
              Lost the connection to the server. Showing the last list we loaded.
            </p>
          )}
        </>
      )}

      <RenameProjectDialog
        open={!!renaming}
        title={renaming?.title ?? ""}
        onOpenChange={(o) => !o && setRenaming(null)}
        onRename={async (title) => {
          if (!renaming) return;
          try {
            const updated = await projectsApi.rename(renaming.id, title);
            setOverrides((o) => ({ ...o, [updated.id]: updated }));
          } catch (err) {
            toast.error(isApiError(err) ? err.message : "Couldn't rename the project.");
            throw err;
          }
        }}
      />
      <DeleteProjectDialog
        open={!!deleting}
        title={deleting?.title ?? ""}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const { id, title } = deleting;
          try {
            await projectsApi.remove(id);
          } catch (err) {
            if (!(isApiError(err) && err.isNotFound)) {
              toast.error(isApiError(err) ? err.message : "Couldn't delete the project.");
              throw err;
            }
          }
          setOverrides((o) => ({ ...o, [id]: null }));
          projectIndex.remove(id);
          toast(`Deleted “${title}”`);
        }}
      />
    </Container>
  );
}

function ServerDown({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const network = isApiError(error) && error.isNetwork;
  return (
    <div role="alert" className="mt-10 rounded-[20px] border border-line bg-surface px-6 py-12 text-center sm:px-10">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-white ring-1 ring-line">
        <WifiOff className="size-5 text-ink-2" aria-hidden />
      </span>
      <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.015em]">
        {network ? "Can’t reach the Shortcraft server" : "Your projects didn’t load"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">
        {network ? (
          <>
            We tried <span className="font-mono text-[13px] text-ink-2">{apiBaseUrl()}</span>. Check that the backend is running,
            then try again. The demo editor works without it.
          </>
        ) : isApiError(error) ? (
          error.message
        ) : (
          "Something went wrong while loading."
        )}
      </p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <button type="button" onClick={onRetry} className={pillButton("primary")}>
          Try again
        </button>
        <Link href="/editor/demo" className={pillButton("secondary")}>
          Open demo editor
        </Link>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <ul className="mt-[88px] grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i}>
          <div className="aspect-[4/5] animate-pulse rounded-[20px] bg-surface motion-reduce:animate-none" />
          <div className="mt-3 h-4 w-2/3 rounded bg-surface" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface" />
        </li>
      ))}
    </ul>
  );
}
