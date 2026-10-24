import { cn } from "@/lib/utils";

export type ProjectStatus = "processing" | "ready" | "failed" | "draft" | "unknown";

const LABEL: Record<ProjectStatus, string> = {
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  draft: "No edit yet",
  unknown: "Checking",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap",
        status === "ready" && "bg-white/95 text-ink",
        status === "processing" && "bg-white/95 text-ink",
        status === "failed" && "bg-white/95 text-cut",
        (status === "draft" || status === "unknown") && "bg-white/90 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "ready" && "bg-[#1f9d55]",
          status === "processing" && "animate-pulse bg-rec motion-reduce:animate-none",
          status === "failed" && "bg-cut",
          (status === "draft" || status === "unknown") && "bg-[#b5b5bc]",
        )}
      />
      {LABEL[status]}
    </span>
  );
}
