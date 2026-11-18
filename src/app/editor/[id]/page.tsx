"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Empty, Icon, Spinner, Notice, inputCls } from "@/components/ui";
import Timeline from "@/components/editor/Timeline";
import { AudioPanel, ExportPanel, FramePanel, SubtitlePanel, TrimPanel, type ClipMeta, type Draft } from "@/components/editor/Panels";
import { api, errMsg, toast, useApi, type ClipItem } from "@/lib/client/api";
import { outputSize, parseAspect } from "@/lib/shared/presets";
import { clamp, fmtTime } from "@/lib/shared/time";
import type { AudioSettings, ClipSubtitles, CropSettings, Timeline as TL } from "@/lib/shared/types";

interface ClipFull {
  id: number;
  mediaId: number;
  title: string;
  startSec: number;
  endSec: number;
  peakSec: number | null;
  score: number;
  confidence: number;
  category: string;
  reason: string;
  evidence: ClipItem["evidence"];
  scores: ClipItem["scores"];
  status: string;
  source: string;
  aspect: string;
  crop: CropSettings;
  audio: AudioSettings;
  subtitles: ClipSubtitles;
}
interface MediaMeta {
  mediaName: string;
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  browserPlayable: boolean;
  hasProxy: boolean;
}

type Tab = "trim" | "frame" | "subs" | "audio" | "export";

function Editor({ initial, media, onReload }: { initial: ClipFull; media: MediaMeta; onReload: () => Promise<void> }) {
  const router = useRouter();
  const { data: siblings, reload: reloadSibs } = useApi<{ clips: ClipItem[] }>(`/api/clips?mediaId=${initial.mediaId}&sort=time`);
  const { data: an } = useApi<{ analysis: { timeline: TL } | null }>(`/api/analyses?mediaId=${initial.mediaId}`);
  const [d, setD] = useState<Draft>({ title: initial.title, startSec: initial.startSec, endSec: initial.endSec, aspect: initial.aspect, crop: initial.crop, audio: initial.audio, subtitles: initial.subtitles, status: initial.status });
  const [tab, setTab] = useState<Tab>("trim");
  const [t, setT] = useState(initial.startSec);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [view, setView] = useState<[number, number]>(() => {
    const pad = Math.max(10, (initial.endSec - initial.startSec) * 0.6);
    return [Math.max(0, initial.startSec - pad), Math.min(media.duration, initial.endSec + pad)];
  });
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [busy, setBusy] = useState(false);
  const vref = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [ovW, setOvW] = useState(0);
  const lastSaved = useRef(JSON.stringify(d));
  const dRef = useRef(d);
  dRef.current = d;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const set = useCallback((p: Partial<Draft>) => setD((x) => ({ ...x, ...p })), []);

  /* ---------- autosave ---------- */
  const flush = useCallback(async () => {
    const cur = dRef.current;
    const snap = JSON.stringify(cur);
    if (snap === lastSaved.current) return;
    setSave("saving");
    try {
      await api(`/api/clips/${initial.id}`, { method: "PATCH", json: { title: cur.title, startSec: cur.startSec, endSec: cur.endSec, aspect: cur.aspect, crop: cur.crop, audio: cur.audio, subtitles: cur.subtitles } });
      lastSaved.current = snap;
      setSave(JSON.stringify(dRef.current) === snap ? "saved" : "dirty");
      void reloadSibs();
    } catch (e) {
      setSave("error");
      toast(errMsg(e), "error");
      throw e;
    }
  }, [initial.id, reloadSibs]);

  useEffect(() => {
    if (JSON.stringify(d) === lastSaved.current) return;
    setSave("dirty");
    const h = setTimeout(() => void flush().catch(() => undefined), 1200);
    return () => clearTimeout(h);
  }, [d, flush]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(dRef.current) !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  /* ---------- playback constrained to the clip ---------- */
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    const onMeta = () => {
      v.currentTime = dRef.current.startSec;
    };
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) onMeta();
    let raf = 0;
    let lastT = -1;
    const tick = () => {
      if (Math.abs(v.currentTime - lastT) > 0.03) {
        lastT = v.currentTime;
        setT(v.currentTime);
      }
      const end = dRef.current.endSec;
      if (!v.paused && v.currentTime >= end) {
        if (loopRef.current) v.currentTime = dRef.current.startSec;
        else v.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [media.browserPlayable, media.hasProxy]);

  const seek = useCallback(
    (time: number) => {
      const v = vref.current;
      const c = clamp(time, 0, media.duration);
      if (v) v.currentTime = c;
      setT(c);
    },
    [media.duration],
  );
  const toggle = useCallback(() => {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < dRef.current.startSec - 0.05 || v.currentTime >= dRef.current.endSec - 0.05) v.currentTime = dRef.current.startSec;
      void v.play();
    } else v.pause();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      const cur = vref.current?.currentTime ?? 0;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "i" || e.key === "[") set({ startSec: Math.max(0, Math.min(cur, dRef.current.endSec - 1)) });
      else if (e.key === "o" || e.key === "]") set({ endSec: Math.min(media.duration, Math.max(cur, dRef.current.startSec + 1)) });
      else if (e.key === "ArrowLeft") seek(cur - (e.shiftKey ? 5 : 1));
      else if (e.key === "ArrowRight") seek(cur + (e.shiftKey ? 5 : 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toggle, seek, set, media.duration]);

  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOvW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- geometry for crop overlay ---------- */
  const A = parseAspect(d.aspect) ?? 9 / 16;
  const vw = media.width || 16;
  const vh = media.height || 9;
  const cw0 = Math.min(vw, vh * A);
  const cw = cw0 / d.crop.zoom;
  const chh = cw0 / A / d.crop.zoom;
  const rect = { l: ((vw - cw) * d.crop.x) / vw, t: ((vh - chh) * d.crop.y) / vh, w: cw / vw, h: chh / vh };
  const dragCrop = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const out1080 = outputSize(A, 1080);

  const cue = d.subtitles.enabled ? d.subtitles.cues.find((c) => t >= c.start && t < c.end) : null;
  const style = d.subtitles.style;
  const rectPx = ovW * rect.w;
  const subScale = (Math.min(out1080.width, out1080.height) / 1080) * (rectPx / out1080.width);

  /* ---------- clip navigation & actions ---------- */
  const sibs = useMemo(() => siblings?.clips ?? [], [siblings]);
  const idx = sibs.findIndex((c) => c.id === initial.id);
  const go = async (id: number) => {
    await flush().catch(() => undefined);
    router.push(`/editor/${id}`);
  };
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try {
      await flush();
      await fn();
      if (msg) toast(msg, "success");
      await onReload();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const meta: ClipMeta = { id: initial.id, reason: initial.reason, evidence: initial.evidence, scores: initial.scores, confidence: initial.confidence, category: initial.category, source: initial.source, score: initial.score, peakSec: initial.peakSec };

  const tabs: [Tab, string][] = [["trim", "Trim"], ["frame", "Frame"], ["subs", "Subtitles"], ["audio", "Audio"], ["export", "Export"]];
  const playable = media.browserPlayable || media.hasProxy;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/highlights?media=${initial.mediaId}`}>
            <Button size="sm" variant="ghost"><Icon name="left" className="h-3.5 w-3.5" /> Highlights</Button>
          </Link>
          <div className="min-w-0 flex-1">
            <input className={`${inputCls} !border-transparent !bg-transparent !px-1 text-base font-semibold hover:!border-line`} value={d.title} onChange={(e) => set({ title: e.target.value })} aria-label="Clip title" />
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            {save === "saving" && <Spinner className="h-3 w-3" />}
            {save === "saved" ? "All changes saved" : save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes…" : "Save failed"}
          </span>
          <Button size="sm" disabled={idx <= 0} onClick={() => go(sibs[idx - 1].id)} title="Previous clip"><Icon name="left" className="h-3.5 w-3.5" /></Button>
          <span className="text-xs text-muted">{idx >= 0 ? `${idx + 1}/${sibs.length}` : ""}</span>
          <Button size="sm" disabled={idx < 0 || idx >= sibs.length - 1} onClick={() => go(sibs[idx + 1].id)} title="Next clip"><Icon name="right" className="h-3.5 w-3.5" /></Button>
        </div>

        <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-black p-2" style={{ height: "46vh" }}>
          {!playable && media.hasVideo ? (
            <div className="text-center text-sm text-muted">
              <Spinner className="mx-auto mb-2 h-5 w-5" />
              Preparing a preview proxy for this format…
              <p className="mt-1 text-xs">Exports use the original file and are not affected.</p>
            </div>
          ) : (
            <div className="relative inline-block max-h-full max-w-full">
              <video ref={vref} src={`/api/media/${initial.mediaId}/stream`} preload="metadata" playsInline className="block max-h-[42vh] max-w-full" style={media.hasVideo ? undefined : { height: 120, width: 400, background: "#0b0d12" }} onClick={toggle} />
              {media.hasVideo && (
                <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
                  {d.crop.mode === "crop" ? (
                    <div
                      className="pointer-events-auto absolute cursor-move overflow-hidden border-2 border-accent"
                      style={{ left: `${rect.l * 100}%`, top: `${rect.t * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
                      onPointerDown={(e) => {
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        dragCrop.current = { x: e.clientX, y: e.clientY, cx: d.crop.x, cy: d.crop.y };
                      }}
                      onPointerMove={(e) => {
                        const g = dragCrop.current;
                        const ov = overlay.current;
                        if (!g || !ov) return;
                        const r = ov.getBoundingClientRect();
                        const freeX = (1 - rect.w) * r.width;
                        const freeY = (1 - rect.h) * r.height;
                        set({ crop: { ...d.crop, x: freeX > 1 ? clamp(g.cx + (e.clientX - g.x) / freeX, 0, 1) : g.cx, y: freeY > 1 ? clamp(g.cy + (e.clientY - g.y) / freeY, 0, 1) : g.cy } });
                      }}
                      onPointerUp={() => (dragCrop.current = null)}
                    >
                      {cue && <Caption text={cue.text} style={style} scale={subScale} outH={out1080.height} />}
                    </div>
                  ) : (
                    <div className="absolute inset-0">{cue && <Caption text={cue.text} style={style} scale={(ovW / out1080.width) * (Math.min(out1080.width, out1080.height) / 1080) * (A > vw / vh ? 1 : 1)} outH={out1080.height} />}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={toggle} disabled={!playable}>
            <Icon name={playing ? "pause" : "play"} /> {playing ? "Pause" : "Play clip"}
          </Button>
          <Button size="sm" onClick={() => seek(d.startSec)} title="Jump to start"><Icon name="left" className="h-3.5 w-3.5" /> Start</Button>
          <Button size="sm" onClick={() => seek(Math.max(d.startSec, d.endSec - 3))} title="Jump to 3 seconds before the end">End −3s</Button>
          <Button size="sm" variant={loop ? "primary" : "default"} onClick={() => setLoop((l) => !l)}><Icon name="loop" className="h-3.5 w-3.5" /> Loop</Button>
          <span className="ml-auto font-mono text-xs text-muted">
            {fmtTime(t, 1)} <span className="opacity-60">/ clip {fmtTime(Math.max(0, t - d.startSec), 1)} of {fmtTime(d.endSec - d.startSec, 1)}</span>
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setView([Math.max(0, d.startSec - Math.max(10, (d.endSec - d.startSec) * 0.6)), Math.min(media.duration, d.endSec + Math.max(10, (d.endSec - d.startSec) * 0.6))])}>Fit clip</Button>
            <Button size="sm" variant="ghost" onClick={() => setView([0, media.duration])}>Full</Button>
            <Button size="sm" variant="ghost" onClick={() => { const c = t; const s = (view[1] - view[0]) / 4; setView([Math.max(0, c - s), Math.min(media.duration, c + s)]); }} aria-label="Zoom in"><Icon name="zoomin" className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { const s = view[1] - view[0]; setView([Math.max(0, view[0] - s / 2), Math.min(media.duration, view[1] + s / 2)]); }} aria-label="Zoom out"><Icon name="zoomout" className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

        <Timeline
          duration={media.duration}
          view={view}
          playhead={t}
          heat={an?.analysis?.timeline ?? null}
          clips={sibs.map((c) => ({ id: c.id, start: c.startSec, end: c.endSec, status: c.status, title: c.title }))}
          currentId={initial.id}
          start={d.startSec}
          end={d.endSec}
          onSeek={seek}
          onRange={(s, e) => set({ startSec: s, endSec: e })}
          onSelect={go}
        />
        <p className="text-xs text-muted">Source: {media.mediaName} · {fmtTime(media.duration)} · drag the handles to trim, click the timeline to seek, click another clip’s block to switch.</p>
      </div>

      <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-line bg-panel/60 lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="flex border-b border-line">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex-1 border-b-2 px-2 py-3 text-xs font-medium transition ${tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "trim" && (
            <TrimPanel
              d={d}
              set={set}
              t={t}
              mediaDuration={media.duration}
              meta={meta}
              busy={busy}
              onAction={(mode) => act(() => api(`/api/clips/${initial.id}/actions`, { method: "POST", json: { action: "regenerate", mode } }), "Boundaries regenerated")}
              onStatus={async (s) => {
                set({ status: s });
                try {
                  await api(`/api/clips/${initial.id}`, { method: "PATCH", json: { status: s } });
                  void reloadSibs();
                } catch (e) {
                  toast(errMsg(e), "error");
                }
              }}
              onDuplicate={async () => {
                try {
                  await flush();
                  const r = await api<{ clip: { id: number } }>(`/api/clips/${initial.id}/actions`, { method: "POST", json: { action: "duplicate" } });
                  toast("Duplicated — opening the copy", "success");
                  router.push(`/editor/${r.clip.id}`);
                } catch (e) {
                  toast(errMsg(e), "error");
                }
              }}
              onDelete={async () => {
                if (!confirm("Delete this clip?")) return;
                try {
                  lastSaved.current = JSON.stringify(dRef.current);
                  await api(`/api/clips/${initial.id}`, { method: "DELETE" });
                  router.push(`/highlights?media=${initial.mediaId}`);
                } catch (e) {
                  toast(errMsg(e), "error");
                }
              }}
            />
          )}
          {tab === "frame" && <FramePanel d={d} set={set} />}
          {tab === "subs" && (
            <SubtitlePanel
              d={d}
              set={set}
              t={t}
              clipId={initial.id}
              onResub={() =>
                act(async () => {
                  const r = await api<{ clip: { subtitles: ClipSubtitles } }>(`/api/clips/${initial.id}/actions`, { method: "POST", json: { action: "resubtitle" } });
                  lastSaved.current = JSON.stringify({ ...dRef.current, subtitles: r.clip.subtitles });
                  set({ subtitles: r.clip.subtitles });
                }, "Subtitles regenerated from transcript")
              }
            />
          )}
          {tab === "audio" && <AudioPanel d={d} set={set} hasAudio={media.hasAudio} />}
          {tab === "export" && <ExportPanel d={d} set={set} clipId={initial.id} flush={flush} durationSec={d.endSec - d.startSec} />}
        </div>
      </aside>
    </div>
  );
}

function Caption({ text, style, scale, outH }: { text: string; style: ClipFull["subtitles"]["style"]; scale: number; outH: number }) {
  const px = Math.max(6, style.size * scale);
  const bg = style.bgOpacity > 0 ? `${style.bgColor}${Math.round(style.bgOpacity * 255).toString(16).padStart(2, "0")}` : "transparent";
  const pos: React.CSSProperties = style.position === "top" ? { top: `${(style.marginV / outH) * 100}%` } : style.position === "middle" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: `${(style.marginV / outH) * 100}%` };
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center px-[5%] text-center" style={pos}>
      <span
        style={{
          fontFamily: `"${style.font}", sans-serif`,
          fontSize: px,
          lineHeight: 1.15,
          fontWeight: style.bold ? 700 : 400,
          color: style.color,
          background: bg,
          padding: style.bgOpacity > 0 ? `${px * 0.1}px ${px * 0.25}px` : 0,
          textTransform: style.uppercase ? "uppercase" : "none",
          WebkitTextStroke: `${Math.max(0, style.outlineWidth * scale * 0.9)}px ${style.outlineColor}`,
          paintOrder: "stroke fill",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useApi<{ clip: ClipFull; media: MediaMeta }>(`/api/clips/${id}`);
  const [rev, setRev] = useState(0);
  if (error) return <div className="p-8"><Empty icon="alert" title="Clip not found">{error}</Empty></div>;
  if (!data) return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  return (
    <div className="flex h-full flex-col">
      {!data.media.hasVideo && (
        <div className="px-4 pt-3">
          <Notice>Audio-only source: exports render the audio over a plain background.</Notice>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Editor
          key={`${id}-${rev}`}
          initial={data.clip}
          media={data.media}
          onReload={async () => {
            await reload();
            setRev((r) => r + 1);
          }}
        />
      </div>
    </div>
  );
}
