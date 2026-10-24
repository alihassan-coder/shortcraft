"use client";

import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { sources as sourcesApi, type Project, type SpriteIndex } from "@/lib/api";
import { derivePipeline, loadPipeline } from "@/lib/api/pipeline";
import type { ProjectLocalInfo } from "@/lib/upload/project-index";
import { formatDuration } from "@/lib/upload/validate";
import { cn } from "@/lib/utils";
import { timeAgo, usePolling } from "./hooks";
import { menuContentClass, menuItemClass } from "./menu";
import { ProjectThumb } from "./project-thumb";
import { StatusBadge, type ProjectStatus } from "./status-badge";

export type ProjectSummary = {
  status: ProjectStatus;
  durationS: number | null;
  sprite: { url: string; index: SpriteIndex } | null;
};

async function loadSummary(project: Project, local: ProjectLocalInfo | undefined, signal: AbortSignal): Promise<ProjectSummary> {
  const loaded = await loadPipeline(
    project.id,
    {
      sourceId: local?.sourceId,
      transcribeJobId: local?.jobs?.transcribe,
      planJobId: local?.jobs?.plan,
      vibe: local?.vibe,
      checkPlan: true,
    },
    signal,
  );
  const { phase } = derivePipeline(loaded);
  // A saved plan always means the editor can open, even mid re-plan.
  const status: ProjectStatus =
    phase === "failed" ? "failed" : loaded.planExists || phase === "ready" ? "ready" : phase === "empty" ? "draft" : "processing";

  const src = loaded.source;
  let sprite: ProjectSummary["sprite"] = null;
  if (src?.urls.sprite && src.urls.sprite_index) {
    const index = await sourcesApi.spriteIndex(src.urls.sprite_index.url, { signal }).catch(() => null);
    if (index) sprite = { url: src.urls.sprite.url, index };
  }
  const durationS = src?.duration_ms ? src.duration_ms / 1000 : (local?.durationS ?? null);
  return { status, durationS, sprite };
}

export function projectHref(id: string, status: ProjectStatus) {
  return status === "ready" ? `/editor/${id}` : `/projects/${id}/processing`;
}

export function ProjectCard({
  project,
  local,
  onRename,
  onDelete,
  onStatus,
}: {
  project: Project;
  local: ProjectLocalInfo | undefined;
  onRename: () => void;
  onDelete: () => void;
  onStatus?: (id: string, status: ProjectStatus) => void;
}) {
  const { data } = usePolling(
    `${project.id}:${local?.sourceId ?? ""}:${local?.jobs?.plan ?? ""}`,
    async (signal) => {
      const summary = await loadSummary(project, local, signal);
      onStatus?.(project.id, summary.status);
      return summary;
    },
    { intervalMs: 4000, shouldContinue: (s) => s.status === "processing" },
  );
  const status = data?.status ?? "unknown";
  const href = projectHref(project.id, status);
  const duration = data?.durationS ?? local?.durationS ?? null;

  return (
    <article className="group relative">
      <Link
        href={href}
        className="block rounded-[20px] focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none"
        aria-label={`${project.title} — ${status === "ready" ? "open in editor" : "see progress"}`}
      >
        <ProjectThumb
          poster={local?.poster}
          sprite={data?.sprite}
          className="aspect-[4/5] rounded-[20px] ring-1 ring-black/5 transition-transform duration-300 group-hover:-translate-y-0.5 motion-reduce:transform-none"
        />
      </Link>
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between">
        <StatusBadge status={status} className="shadow-[0_1px_2px_rgba(0,0,0,0.08)]" />
        {duration != null && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums backdrop-blur">
            {formatDuration(duration)}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium text-ink">
            <Link href={href} className="hover:underline focus-visible:underline focus-visible:outline-none" tabIndex={-1}>
              {project.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Edited {timeAgo(project.updated_at).toLowerCase()}</p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={`Actions for ${project.title}`}
            className={cn(
              "-mr-1 grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface hover:text-ink focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none data-[state=open]:bg-surface",
            )}
          >
            <MoreHorizontal className="size-[18px]" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
              <DropdownMenu.Item asChild className={menuItemClass}>
                <Link href={href}>
                  <ExternalLink className="size-4" aria-hidden />
                  Open
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItemClass} onSelect={onRename}>
                <Pencil className="size-4" aria-hidden />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item className={cn(menuItemClass, "text-cut [&_svg]:text-cut")} onSelect={onDelete}>
                <Trash2 className="size-4" aria-hidden />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </article>
  );
}
