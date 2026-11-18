"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Field, Icon, Toggle, inputCls, Notice } from "../ui";
import ExportForm from "../ExportForm";
import { PreviewModal, catLabel } from "../ClipCard";
import { api, errMsg, toast, useApi, type ClipItem, type SystemInfo } from "@/lib/client/api";
import { ASPECT_OPTIONS, parseAspect } from "@/lib/shared/presets";
import { DEFAULT_CROP, DEFAULT_EXPORT } from "@/lib/shared/defaults";
import { fmtDuration, fmtTime, parseTime } from "@/lib/shared/time";
import type { AppSettings, AudioSettings, ClipSubtitles, CropSettings, Cue, ExportSettings, SubtitleStyle } from "@/lib/shared/types";

export interface Draft {
  title: string;
  startSec: number;
  endSec: number;
  aspect: string;
  crop: CropSettings;
  audio: AudioSettings;
  subtitles: ClipSubtitles;
  status: string;
}

export interface ClipMeta extends Pick<ClipItem, "reason" | "evidence" | "scores" | "confidence" | "category" | "source"> {
  id: number;
  score: number;
  peakSec: number | null;
}

export function TimeInput({ value, onCommit, className = "" }: { value: number; onCommit: (v: number) => void; className?: string }) {
  const [text, setText] = useState(fmtTime(value, 2));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(fmtTime(value, 2));
  }, [value, focus]);
  const commit = () => {
    setFocus(false);
    const v = parseTime(text);
    if (v === null) setText(fmtTime(value, 2));
    else onCommit(v);
  };
  return <input className={`${inputCls} font-mono ${className}`} value={text} onFocus={() => setFocus(true)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function Nudge({ onNudge }: { onNudge: (d: number) => void }) {
  return (
    <div className="mt-1.5 flex gap-1">
      {[-1, -0.1, 0.1, 1].map((d) => (
        <button key={d} onClick={() => onNudge(d)} className="flex-1 rounded border border-line bg-panel2 py-1 font-mono text-[11px] text-muted hover:text-fg">
          {d > 0 ? "+" : "−"}
          {Math.abs(d)}s
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------- Trim ----------------------------------- */
export function TrimPanel({
  d, set, t, mediaDuration, meta, onAction, onStatus, onDuplicate, onDelete, busy,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
  t: number;
  mediaDuration: number;
  meta: ClipMeta;
  onAction: (mode: "resnap" | "longer" | "shorter") => void;
  onStatus: (s: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const setStart = (v: number) => set({ startSec: Math.max(0, Math.min(v, d.endSec - 1)) });
  const setEnd = (v: number) => set({ endSec: Math.min(mediaDuration, Math.max(v, d.startSec + 1)) });
  const eng = meta.scores?.engagement;
  return (
    <div className="space-y-5">
      <Field label="Title">
        <input className={inputCls} value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Start</span>
          <TimeInput value={d.startSec} onCommit={setStart} />
          <Nudge onNudge={(x) => setStart(d.startSec + x)} />
          <Button size="sm" className="mt-1.5 w-full" onClick={() => setStart(t)}>Set to playhead</Button>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">End</span>
          <TimeInput value={d.endSec} onCommit={setEnd} />
          <Nudge onNudge={(x) => setEnd(d.endSec + x)} />
          <Button size="sm" className="mt-1.5 w-full" onClick={() => setEnd(t)}>Set to playhead</Button>
        </div>
      </div>
      <p className="text-center text-xs text-muted">
        Duration <span className="font-mono text-fg">{fmtDuration(d.endSec - d.startSec)}</span> · shortcuts: <kbd className="rounded bg-panel2 px-1">I</kbd> / <kbd className="rounded bg-panel2 px-1">O</kbd> set in/out, <kbd className="rounded bg-panel2 px-1">Space</kbd> play
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => setStart(d.startSec - 5)}>Extend start 5s</Button>
        <Button size="sm" onClick={() => setEnd(d.endSec + 5)}>Extend end 5s</Button>
        <Button size="sm" onClick={() => setStart(d.startSec + 5)}>Shorten start 5s</Button>
        <Button size="sm" onClick={() => setEnd(d.endSec - 5)}>Shorten end 5s</Button>
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Regenerate boundaries with AI</span>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAction("resnap")}><Icon name="refresh" className="h-3 w-3" /> Re-snap</Button>
          <Button size="sm" disabled={busy} onClick={() => onAction("longer")}>Longer</Button>
          <Button size="sm" disabled={busy} onClick={() => onAction("shorter")}>Shorter</Button>
        </div>
        <p className="mt-1 text-[11px] text-muted">Recomputes start/end around the detected peak using transcript sentence boundaries and silences.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={d.status === "approved" ? "success" : "default"} className="flex-1" onClick={() => onStatus(d.status === "approved" ? "pending" : "approved")}>
          <Icon name="check" /> {d.status === "approved" ? "Approved" : "Approve"}
        </Button>
        <Button variant={d.status === "rejected" ? "danger" : "default"} className="flex-1" onClick={() => onStatus(d.status === "rejected" ? "pending" : "rejected")}>
          <Icon name="x" /> {d.status === "rejected" ? "Rejected" : "Reject"}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onDuplicate}><Icon name="copy" className="h-3.5 w-3.5" /> Duplicate</Button>
        <Button size="sm" variant="danger" className="flex-1" onClick={onDelete}><Icon name="trash" className="h-3.5 w-3.5" /> Delete</Button>
      </div>

      <div className="rounded-xl border border-line bg-bg p-3 text-xs">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{catLabel(meta.category)}</Badge>
          <Badge tone="green">Score {Math.round(meta.score)}</Badge>
          <Badge>{Math.round(meta.confidence * 100)}% confidence</Badge>
          {meta.scores?.loudnessOnly && <Badge tone="amber">loudness only</Badge>}
        </div>
        <p className="mb-2 text-muted">{meta.reason || "No automatic explanation (manual clip)."}</p>
        <ul className="space-y-1">
          {meta.evidence.slice(0, 6).map((e, i) => (
            <li key={i} className="flex gap-2"><span className="shrink-0 font-mono text-muted">{fmtTime(e.time)}</span><span>{e.label}</span></li>
          ))}
        </ul>
        {eng && <p className="mt-2 text-muted">Engagement estimate {eng.overall}/100 (emotion {eng.emotional}, entertainment {eng.entertainment}, context {eng.context}, uniqueness {eng.uniqueness}, narrative {eng.narrative}). An estimate only — not a prediction of performance.</p>}
      </div>
    </div>
  );
}

/* ----------------------------------- Frame ----------------------------------- */
export function FramePanel({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const custom = !ASPECT_OPTIONS.includes(d.aspect);
  const [customText, setCustomText] = useState(custom ? d.aspect : "21:9");
  const setCrop = (p: Partial<CropSettings>) => set({ crop: { ...d.crop, ...p } });
  return (
    <div className="space-y-5">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted">Aspect ratio</span>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_OPTIONS.map((a) => (
            <button key={a} onClick={() => set({ aspect: a })} className={`rounded-lg border px-2 py-2 text-sm ${d.aspect === a ? "border-accent bg-accent/10" : "border-line hover:border-accent/40"}`}>{a}</button>
          ))}
          <button onClick={() => parseAspect(customText) && set({ aspect: customText })} className={`rounded-lg border px-2 py-2 text-sm ${custom ? "border-accent bg-accent/10" : "border-line hover:border-accent/40"}`}>Custom</button>
        </div>
        <div className="mt-2 flex gap-2">
          <input className={inputCls} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="21:9" />
          <Button size="sm" disabled={!parseAspect(customText)} onClick={() => set({ aspect: customText.replace(/\s/g, "") })}>Apply</Button>
        </div>
        <p className="mt-1 text-[11px] text-muted">Current: <span className="font-mono">{d.aspect}</span></p>
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted">Fit mode</span>
        <div className="grid grid-cols-2 gap-2">
          {([["crop", "Crop to fill", "Fills the frame; choose the focus point"], ["blur", "Fit + blurred background", "Whole picture visible, bars filled with blur"]] as const).map(([m, l, h]) => (
            <button key={m} onClick={() => setCrop({ mode: m })} className={`rounded-lg border p-2.5 text-left ${d.crop.mode === m ? "border-accent bg-accent/10" : "border-line hover:border-accent/40"}`}>
              <div className="text-sm font-medium">{l}</div>
              <div className="text-[11px] text-muted">{h}</div>
            </button>
          ))}
        </div>
      </div>
      {d.crop.mode === "crop" && (
        <>
          <p className="text-xs text-muted">Drag the highlighted frame on the video to choose what stays in view, or use the sliders.</p>
          {([["x", "Horizontal focus"], ["y", "Vertical focus"]] as const).map(([k, l]) => (
            <label key={k} className="block text-xs text-muted">
              <span className="flex justify-between">{l}<span className="text-fg">{Math.round(d.crop[k] * 100)}%</span></span>
              <input type="range" min={0} max={1} step={0.01} className="w-full" value={d.crop[k]} onChange={(e) => setCrop({ [k]: +e.target.value })} />
            </label>
          ))}
          <label className="block text-xs text-muted">
            <span className="flex justify-between">Zoom<span className="text-fg">{d.crop.zoom.toFixed(2)}×</span></span>
            <input type="range" min={1} max={3} step={0.05} className="w-full" value={d.crop.zoom} onChange={(e) => setCrop({ zoom: +e.target.value })} />
          </label>
          <Button size="sm" onClick={() => set({ crop: { ...DEFAULT_CROP } })}>Reset framing</Button>
        </>
      )}
    </div>
  );
}

/* --------------------------------- Subtitles --------------------------------- */
const FONTS = ["Arial", "Arial Black", "Segoe UI", "Impact", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Comic Sans MS", "Consolas"];

export function SubtitlePanel({ d, set, t, clipId, onResub }: { d: Draft; set: (p: Partial<Draft>) => void; t: number; clipId: number; onResub: () => void }) {
  const sub = d.subtitles;
  const setSub = (p: Partial<ClipSubtitles>) => set({ subtitles: { ...sub, ...p } });
  const setStyle = (p: Partial<SubtitleStyle>) => setSub({ style: { ...sub.style, ...p } });
  const cues = sub.cues.map((c, i) => ({ c, i })).filter(({ c }) => c.end > d.startSec && c.start < d.endSec);
  const updateCue = (i: number, p: Partial<Cue>) => setSub({ cues: sub.cues.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const st = sub.style;
  return (
    <div className="space-y-5">
      <Toggle checked={sub.enabled} onChange={(v) => setSub({ enabled: v })} label="Show subtitles" hint="Burned in or exported as a soft track/SRT depending on export settings." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onResub}><Icon name="refresh" className="h-3.5 w-3.5" /> From transcript</Button>
        <Button size="sm" onClick={() => setSub({ enabled: true, cues: [...sub.cues, { start: Math.max(d.startSec, Math.min(t, d.endSec - 2)), end: Math.min(d.endSec, Math.max(t, d.startSec) + 2), text: "New caption" }].sort((a, b) => a.start - b.start) })}>
          <Icon name="plus" className="h-3.5 w-3.5" /> Add at playhead
        </Button>
        {sub.cues.length > 0 && <a href={`/api/clips/${clipId}/srt`}><Button size="sm">Download .srt</Button></a>}
      </div>
      {cues.length === 0 ? (
        <Notice>No subtitle cues in this clip. Use “From transcript” (needs a transcript from analysis or an imported .srt) or add captions manually.</Notice>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {cues.map(({ c, i }) => (
            <div key={i} className={`rounded-lg border p-2 ${t >= c.start && t < c.end ? "border-accent" : "border-line"}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <TimeInput className="!px-2 !py-1 text-xs" value={c.start} onCommit={(v) => updateCue(i, { start: v, end: Math.max(c.end, v + 0.2) })} />
                <span className="text-muted">→</span>
                <TimeInput className="!px-2 !py-1 text-xs" value={c.end} onCommit={(v) => updateCue(i, { end: Math.max(v, c.start + 0.2) })} />
                <button onClick={() => setSub({ cues: sub.cues.filter((_, k) => k !== i) })} className="text-muted hover:text-rose-400" aria-label="Delete cue"><Icon name="trash" className="h-3.5 w-3.5" /></button>
              </div>
              <textarea rows={2} className={`${inputCls} !py-1.5`} value={c.text} onChange={(e) => updateCue(i, { text: e.target.value })} />
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 border-t border-line pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Style</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Font">
            <input className={inputCls} list="fonts" value={st.font} onChange={(e) => setStyle({ font: e.target.value })} />
            <datalist id="fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
          <Field label="Position">
            <select className={inputCls} value={st.position} onChange={(e) => setStyle({ position: e.target.value as SubtitleStyle["position"] })}>
              <option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option>
            </select>
          </Field>
          <Field label="Text color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-bg" value={st.color} onChange={(e) => setStyle({ color: e.target.value })} /></Field>
          <Field label="Outline color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-bg" value={st.outlineColor} onChange={(e) => setStyle({ outlineColor: e.target.value })} /></Field>
          <Field label="Background color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-bg" value={st.bgColor} onChange={(e) => setStyle({ bgColor: e.target.value })} /></Field>
        </div>
        {([["size", "Font size", 20, 160, 1], ["outlineWidth", "Outline width", 0, 12, 0.5], ["bgOpacity", "Background opacity", 0, 1, 0.05], ["marginV", "Distance from edge", 0, 600, 10]] as const).map(([k, l, mn, mx, step]) => (
          <label key={k} className="block text-xs text-muted">
            <span className="flex justify-between">{l}<span className="text-fg">{k === "bgOpacity" ? `${Math.round(st[k] * 100)}%` : st[k]}</span></span>
            <input type="range" min={mn} max={mx} step={step} className="w-full" value={st[k]} onChange={(e) => setStyle({ [k]: +e.target.value })} />
          </label>
        ))}
        <div className="flex gap-6">
          <Toggle checked={st.bold} onChange={(v) => setStyle({ bold: v })} label="Bold" />
          <Toggle checked={st.uppercase} onChange={(v) => setStyle({ uppercase: v })} label="UPPERCASE" />
        </div>
        <p className="text-[11px] text-muted">Fonts must be installed on the computer that renders the export; otherwise a similar fallback font is used. A background box and an outline can be combined.</p>
      </div>
    </div>
  );
}

/* ----------------------------------- Audio ----------------------------------- */
export function AudioPanel({ d, set, hasAudio }: { d: Draft; set: (p: Partial<Draft>) => void; hasAudio: boolean }) {
  const a = d.audio;
  const setA = (p: Partial<AudioSettings>) => set({ audio: { ...a, ...p } });
  if (!hasAudio) return <Notice>This media has no audio track.</Notice>;
  return (
    <div className="space-y-5">
      <Toggle checked={a.mute} onChange={(v) => setA({ mute: v })} label="Mute clip" />
      <label className="block text-xs text-muted">
        <span className="flex justify-between">Volume<span className="text-fg">{Math.round(a.volume * 100)}%</span></span>
        <input type="range" min={0} max={2} step={0.05} className="w-full" value={a.volume} disabled={a.mute} onChange={(e) => setA({ volume: +e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        <span className="flex justify-between">Fade in<span className="text-fg">{a.fadeIn.toFixed(1)}s</span></span>
        <input type="range" min={0} max={5} step={0.1} className="w-full" value={a.fadeIn} onChange={(e) => setA({ fadeIn: +e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        <span className="flex justify-between">Fade out<span className="text-fg">{a.fadeOut.toFixed(1)}s</span></span>
        <input type="range" min={0} max={5} step={0.1} className="w-full" value={a.fadeOut} onChange={(e) => setA({ fadeOut: +e.target.value })} />
      </label>
      <Toggle checked={a.normalize} onChange={(v) => setA({ normalize: v })} label="Normalize loudness" hint="EBU R128 loudness normalization to −16 LUFS, a common target for social platforms." />
      <p className="text-[11px] text-muted">Audio settings are applied in “Render preview” and in exports (the live player always plays the original audio).</p>
    </div>
  );
}

/* ----------------------------------- Export ----------------------------------- */
export function ExportPanel({ d, set, clipId, flush, durationSec }: { d: Draft; set: (p: Partial<Draft>) => void; clipId: number; flush: () => Promise<void>; durationSec: number }) {
  const { data: sys } = useApi<SystemInfo>("/api/system");
  const { data: sd } = useApi<{ settings: AppSettings }>("/api/settings");
  const [ex, setEx] = useState<ExportSettings>({ ...DEFAULT_EXPORT, aspect: "clip" });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (sd) setEx({ ...sd.settings.export, aspect: "clip" });
  }, [sd]);

  const change = (v: ExportSettings) => {
    if (v.aspect !== "clip") {
      set({ aspect: v.aspect });
      v = { ...v, aspect: "clip" };
    }
    setEx(v);
  };
  const start = async () => {
    setBusy(true);
    try {
      await flush();
      await api("/api/exports", { method: "POST", json: { clipIds: [clipId], settings: ex } });
      toast("Export queued — track it in the Export Manager", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Clip framing: <span className="font-mono">{d.aspect}</span> (change in the Frame tab).</p>
      <ExportForm value={ex} onChange={change} sys={sys} durations={[durationSec]} />
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy} onClick={start}><Icon name="download" /> Export clip</Button>
        <Button onClick={async () => { await flush().catch(() => undefined); setPreview(true); }}><Icon name="play" /> Render preview</Button>
      </div>
      <Link href="/exports" className="block text-center text-xs text-accent hover:underline">Open Export Manager</Link>
      {preview && <PreviewModal clipId={clipId} title={d.title} onClose={() => setPreview(false)} />}
    </div>
  );
}
