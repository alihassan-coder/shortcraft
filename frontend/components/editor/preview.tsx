"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Pause, Play, SkipBack } from "lucide-react";
import { formatTime } from "@/lib/edit-plan/timeline";
import { playerControls, registerPlayer } from "@/lib/editor/player";
import { usePlanStore, useTimeline, useUiStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { ShortVideo, planDurationInFrames } from "@/remotion/short-video";

export function Preview() {
  const plan = usePlanStore((s) => s.plan);
  const { original, setOriginal, safeZones, playing, setPlaying, setCurrentMs, currentMs } = useUiStore();
  const ref = useRef<PlayerRef>(null);
  const { fps, width, height } = plan.canvas;
  const durationInFrames = planDurationInFrames(plan, original);
  const totalMs = useTimeline().durationMs;
  const inputProps = useMemo(() => ({ plan, original }), [plan, original]);

  const attach = useCallback(
    (node: PlayerRef | null) => {
      ref.current = node;
      registerPlayer(node);
    },
    [],
  );

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setCurrentMs((e.detail.frame / fps) * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onPause);
    };
  }, [fps, setCurrentMs, setPlaying]);

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-4">
      <div className="relative min-h-0 w-full flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-[18px] bg-black shadow-frame"
            style={{ aspectRatio: `${width} / ${height}`, height: width >= height ? "auto" : "100%", width: width >= height ? "100%" : "auto" }}
          >
            <Player
              ref={attach}
              component={ShortVideo}
              inputProps={inputProps}
              durationInFrames={durationInFrames}
              fps={fps}
              compositionWidth={width}
              compositionHeight={height}
              style={{ width: "100%", height: "100%" }}
              clickToPlay
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              acknowledgeRemotionLicense
            />
            {safeZones && <SafeZones />}
            {original && (
              <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                Original
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex w-full max-w-[420px] items-center gap-3">
        <button
          onClick={() => playerControls.seekOutputMs(0)}
          className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface"
          aria-label="Back to start"
        >
          <SkipBack className="size-4" />
        </button>
        <button
          onClick={() => playerControls.toggle()}
          className="grid size-11 place-items-center rounded-full bg-ink text-white hover:bg-ink-2"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <span className="font-mono text-xs text-muted-foreground">
          {formatTime(currentMs, true)} / {formatTime(totalMs, true)}
        </span>
        <div className="ml-auto inline-flex rounded-full bg-surface p-0.5 text-xs" role="group" aria-label="Preview mode">
          {[
            { v: false, l: "Edited" },
            { v: true, l: "Original" },
          ].map((o) => (
            <button
              key={o.l}
              onClick={() => {
                setOriginal(o.v);
                playerControls.seekOutputMs(0);
              }}
              aria-pressed={original === o.v}
              className={cn("rounded-full px-3 py-1.5", original === o.v ? "bg-white font-medium shadow-sm" : "text-muted-foreground")}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Areas covered by TikTok/Reels UI: top bar, right action column, bottom caption area.
function SafeZones() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[9%] bg-rec/25" />
      <div className="absolute top-[30%] right-0 bottom-[20%] w-[15%] bg-rec/25" />
      <div className="absolute inset-x-0 bottom-0 h-[20%] bg-rec/25" />
      <span className="absolute bottom-[21%] left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        Keep captions out of the orange areas
      </span>
    </div>
  );
}
