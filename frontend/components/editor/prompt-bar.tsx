"use client";

import { useEffect, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { runPrompt } from "@/lib/editor/mock-director";
import { undo } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

type Reply = { ask: string; ok: boolean; changes: string[] };

export function PromptBar() {
  const [value, setValue] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);

  // The reply sits over the preview, so let it step aside on its own.
  useEffect(() => {
    if (!reply) return;
    const t = setTimeout(() => setReply(null), 9000);
    return () => clearTimeout(t);
  }, [reply]);

  const send = (text: string) => {
    const ask = text.trim();
    if (!ask || busy) return;
    setBusy(true);
    setValue("");
    // Small delay so the change reads as an action, not a flicker.
    setTimeout(() => {
      setReply({ ask, ...runPrompt(ask) });
      setBusy(false);
    }, 450);
  };

  return (
    <div className="relative">
      {reply && (
        <div className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border bg-white p-4 shadow-frame">
          <p className="text-[13px] text-muted-foreground">“{reply.ask}”</p>
          {reply.ok ? (
            <>
              <ul className="mt-2 space-y-1 text-sm">
                {reply.changes.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-rec" />
                    {c}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    undo();
                    setReply(null);
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-surface"
                >
                  <RotateCcw className="size-3.5" /> Undo
                </button>
                <button onClick={() => setReply(null)} className="h-8 rounded-full bg-ink px-3 text-[13px] text-white">
                  Keep
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm">
              I can&apos;t do that one yet. Try one of the suggestions below.{" "}
              <button onClick={() => setReply(null)} className="text-muted-foreground underline underline-offset-2">
                Dismiss
              </button>
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(value);
        }}
        className="flex items-center gap-2 rounded-full border bg-white py-1 pr-1 pl-3.5 focus-within:border-ink focus-within:ring-3 focus-within:ring-rec/15"
      >
        <Sparkles className="size-4 shrink-0 text-rec" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Describe a change, like “make it calmer”"
          aria-label="Describe a change"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!value.trim() || busy}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full bg-ink text-white transition disabled:bg-surface disabled:text-muted-foreground",
            busy && "animate-pulse",
          )}
          aria-label="Send"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}
