"use client";

import { useState } from "react";
import { AlertDialog } from "radix-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const pillButton = (variant: "primary" | "secondary" | "danger" | "ghost" = "primary") =>
  cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" && "bg-ink text-white hover:bg-ink-2",
    variant === "secondary" && "bg-surface text-ink hover:bg-[#ebebef]",
    variant === "danger" && "bg-cut text-white hover:bg-[#d93a2f]",
    variant === "ghost" && "text-ink hover:bg-surface",
  );

export function DeleteProjectDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[20px] bg-white p-6 shadow-frame data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-[19px] font-semibold tracking-[-0.015em]">Delete this project?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[15px] text-muted-foreground">
            “{title}” and its video, captions and edits will be removed for good. This can’t be undone.
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel className={pillButton("secondary")} disabled={busy}>
              Keep it
            </AlertDialog.Cancel>
            <button
              type="button"
              className={pillButton("danger")}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function RenameProjectDialog({
  open,
  title,
  onOpenChange,
  onRename,
}: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 rounded-[20px] p-6 sm:max-w-[420px]">
        {/* Remount per open so the field starts from the current title. */}
        {open && <RenameForm title={title} onRename={onRename} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ title, onRename, onDone }: { title: string; onRename: (t: string) => Promise<void>; onDone: () => void }) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!trimmed || trimmed === title) return onDone();
        setBusy(true);
        try {
          await onRename(trimmed);
          onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      <DialogTitle className="text-[19px] font-semibold tracking-[-0.015em]">Rename project</DialogTitle>
      <DialogDescription className="mt-1.5 text-[15px]">Only you see this name.</DialogDescription>
      <label htmlFor="project-title" className="sr-only">
        Project name
      </label>
      <input
        id="project-title"
        autoFocus
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-5 h-12 w-full rounded-[12px] border border-input bg-white px-4 text-[15px] outline-none focus:border-rec focus:ring-3 focus:ring-rec/20"
      />
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={pillButton("secondary")} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className={pillButton("primary")} disabled={busy || !trimmed}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
