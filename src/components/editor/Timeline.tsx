"use client";
import { useMemo, useRef } from "react";
import { fmtTime } from "@/lib/shared/time";
import type { Timeline as TL } from "@/lib/shared/types";

export interface TLClip {
  id: number;
  start: number;
  end: number;
  status: string;
  title: string;
}

function Heat({ arr, view, color, className }: { arr: number[]; view: [number, number]; color: string; className: string }) {
  const d = useMemo(() => {
    const N = 320;
    const [v0, v1] = view;
    const span = v1 - v0;
    let p = "M0,100";
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, Math.floor(v0 + (i / N) * span));
      const b = Math.min(arr.length, Math.max(a + 1, Math.ceil(v0 + ((i + 1) / N) * span)));
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, arr[k] ?? 0);
      p += ` L${i},${100 - Math.min(1, m) * 100}`;
    }
    return p + ` L${N},100 Z`;
  }, [arr, view]);
  return (
    <svg viewBox="0 0 320 100" preserveAspectRatio="none" className={className}>
      <path d={d} fill={color} />
    </svg>
  );
}

function niceStep(span: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => span / s <= 10) ?? 3600;
}

export default function Timeline({
  duration,
  view,
  playhead,
  heat,
  clips,
  currentId,
  start,
  end,
  onSeek,
  onRange,
  onSelect,
}: {
  duration: number;
  view: [number, number];
  playhead: number;
  heat: TL | null;
  clips: TLClip[];
  currentId: number;
  start: number;
  end: number;
  onSeek: (t: number) => void;
  onRange: (s: number, e: number) => void;
  onSelect: (id: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "start" | "end" | "move"; x0: number; s0: number; e0: number } | null>(null);
  const [v0, v1] = view;
  const span = Math.max(1, v1 - v0);
  const pct = (t: number) => ((t - v0) / span) * 100;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, v0 + ((clientX - r.left) / r.width) * span));
  };
  const snap = (t: number) => Math.round(t * 10) / 10;

  const ticks = useMemo(() => {
    const step = niceStep(span);
    const out: number[] = [];
    for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) out.push(t);
    return out;
  }, [v0, v1, span]);

  const down = (mode: "start" | "end" | "move") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, s0: start, e0: end };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current) return;
    const w = track.current.getBoundingClientRect().width;
    const dt = ((e.clientX - d.x0) / w) * span;
    if (d.mode === "start") onRange(snap(Math.max(0, Math.min(d.s0 + dt, d.e0 - 1))), d.e0);
    else if (d.mode === "end") onRange(d.s0, snap(Math.min(duration, Math.max(d.e0 + dt, d.s0 + 1))));
    else {
      const len = d.e0 - d.s0;
      const s = Math.max(0, Math.min(d.s0 + dt, duration - len));
      onRange(snap(s), snap(s + len));
    }
  };
  const up = () => (drag.current = null);

  const h = heat;
  return (
    <div className="select-none rounded-xl border border-line bg-panel p-3">
      <div className="relative h-5 text-[10px] text-muted">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono" style={{ left: `${pct(t)}%` }}>
            {fmtTime(t)}
          </span>
        ))}
      </div>
      <div
        ref={track}
        className="relative h-24 cursor-pointer overflow-hidden rounded-lg bg-bg"
        onPointerDown={(e) => onSeek(timeAt(e.clientX))}
        onPointerMove={move}
        onPointerUp={up}
      >
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 h-full w-px bg-line/60" style={{ left: `${pct(t)}%` }} />
        ))}
        {h ? (
          <>
            <Heat arr={h.combined} view={view} color="color-mix(in srgb, var(--c-accent) 70%, transparent)" className="absolute inset-x-0 top-0 h-12 w-full" />
            <Heat arr={h.audio} view={view} color="rgba(34,211,238,0.55)" className="absolute inset-x-0 top-12 h-4 w-full" />
            <Heat arr={h.motion} view={view} color="rgba(251,191,36,0.55)" className="absolute inset-x-0 top-16 h-4 w-full" />
            <Heat arr={h.chat.some((x) => x > 0) ? h.chat : h.semantic} view={view} color="rgba(52,211,153,0.55)" className="absolute inset-x-0 top-20 h-4 w-full" />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">Run AI analysis to see the highlight-score heatmap</div>
        )}
        {clips
          .filter((c) => c.id !== currentId && c.end > v0 && c.start < v1)
          .map((c) => (
            <button
              key={c.id}
              title={c.title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(c.id)}
              className={`absolute top-0 h-full border-x ${c.status === "approved" ? "border-emerald-400/70 bg-emerald-400/15" : c.status === "rejected" ? "border-rose-400/40 bg-rose-400/5" : "border-white/30 bg-white/10"} hover:bg-white/20`}
              style={{ left: `${pct(c.start)}%`, width: `${pct(c.end) - pct(c.start)}%` }}
            />
          ))}
        <div className="absolute top-0 h-full border-y-2 border-accent bg-accent/20" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} onPointerDown={down("move")}>
          <div className="absolute inset-y-0 left-0 w-2.5 -translate-x-1/2 cursor-ew-resize rounded bg-accent shadow" onPointerDown={down("start")} title="Drag to trim start" />
          <div className="absolute inset-y-0 right-0 w-2.5 translate-x-1/2 cursor-ew-resize rounded bg-accent shadow" onPointerDown={down("end")} title="Drag to trim end" />
        </div>
        <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white" style={{ left: `${pct(playhead)}%` }}>
          <div className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent/70" />Highlight score</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-400/70" />Audio events</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400/70" />Visual action</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400/70" />Chat / speech meaning</span>
      </div>
    </div>
  );
}
