"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { projectIndex } from "@/lib/upload/project-index";

export type AsyncState<T> = { data: T | undefined; error: unknown; loading: boolean };

/**
 * Run `load` now and then every `intervalMs` (if given), one call at a time, each with its own
 * AbortSignal. Stops on unmount or when `key` changes. `refresh()` runs it again right away.
 * Return `{ stop: true }`-style control by having `shouldContinue(data)` return false.
 */
export function usePolling<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  { intervalMs, shouldContinue }: { intervalMs?: number; shouldContinue?: (data: T) => boolean } = {},
) {
  const [state, setState] = useState<AsyncState<T> & { key: string | null }>({
    data: undefined,
    error: null,
    loading: true,
    key,
  });
  const loadRef = useRef(load);
  const continueRef = useRef(shouldContinue);
  useEffect(() => {
    loadRef.current = load;
    continueRef.current = shouldContinue;
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      try {
        const data = await loadRef.current(controller.signal);
        if (controller.signal.aborted) return;
        setState({ data, error: null, loading: false, key });
        if (intervalMs && (continueRef.current?.(data) ?? true)) timer = setTimeout(run, intervalMs);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((prev) => ({ ...prev, error, loading: false, key }));
        // Keep polling through blips (server restart, flaky wifi), a bit slower.
        if (intervalMs) timer = setTimeout(run, intervalMs * 2);
      }
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, intervalMs, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // Data from a previous key is never shown for the new one.
  const current = state.key === key ? state : { data: undefined, error: null, loading: true };
  return { data: current.data, error: current.error, loading: current.loading, refresh };
}

/** This browser's notes about every project (source id, vibe, poster). */
export function useProjectIndex() {
  return useSyncExternalStore(projectIndex.subscribe, projectIndex.getAll, projectIndex.getServerSnapshot);
}

/** `"3 min ago"`, `"Yesterday"`, `"12 Oct"`. */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
