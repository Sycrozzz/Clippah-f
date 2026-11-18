"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Modal, Toggle, inputCls, Notice } from "./ui";
import { api, errMsg, toast, useApi, type MediaItem, type SystemInfo } from "@/lib/client/api";
import { CATEGORIES, type AnalysisConfig, type AppSettings } from "@/lib/shared/types";

const WEIGHT_LABELS: [keyof AppSettings["weights"], string][] = [
  ["audio", "Audio events"],
  ["visual", "Visual action"],
  ["semantic", "Speech / meaning"],
  ["chat", "Live chat"],
  ["game", "Game events"],
  ["keyword", "Keywords"],
];

export default function AnalyzeDialog({ media, onClose }: { media: MediaItem | null; onClose: () => void }) {
  const router = useRouter();
  const { data: s } = useApi<{ settings: AppSettings }>(media ? "/api/settings" : null);
  const { data: sys } = useApi<SystemInfo>(media ? "/api/system" : null);
  const [cfg, setCfg] = useState<Partial<AnalysisConfig> & { keywordText: string }>({ keywordText: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!s) return;
    const c = s.settings.clips;
    setCfg({
      keywordText: "",
      categoryOverride: "auto",
      minDuration: c.minDuration,
      maxDuration: c.maxDuration,
      targetDuration: c.targetDuration,
      maxClips: c.maxClips,
      adaptive: c.adaptive,
      weights: { ...s.settings.weights },
      language: s.settings.transcription.language,
      useChat: true,
      useVision: s.settings.llm.useVision,
      retranscribe: false,
      replaceExisting: true,
    });
  }, [s]);

  if (!media) return null;
  const set = <K extends keyof AnalysisConfig>(k: K, v: AnalysisConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { keywordText, ...rest } = cfg;
      const keywords = keywordText.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
      await api("/api/jobs", { method: "POST", json: { type: "analysis", mediaId: media.id, config: { ...rest, keywords } } });
      toast("Analysis queued", "success");
      onClose();
      router.push("/analysis");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Analyze “${media.originalName}”`} wide>
      <div className="space-y-5">
        {sys && !sys.ai.transcription.ready && !media.hasTranscript && (
          <Notice tone="warn">
            Speech recognition isn’t configured ({sys.ai.transcription.reason}). Analysis will still use audio and visual signals, but transcript-based features (semantic detection, keywords, subtitles) need a transcript.
            Configure a provider in Settings, or attach an .srt file to this media first.
          </Notice>
        )}
        {sys && sys.ai.semantic.reason && (
          <Notice>
            {sys.ai.semantic.reason} The built-in rule-based text analyzer will be used instead.
          </Notice>
        )}
        <Field label="Custom keywords, names or phrases" hint="Comma- or line-separated. Every transcript mention becomes a candidate moment (requires a transcript).">
          <textarea className={inputCls} rows={2} placeholder="e.g. Bruce Wayne, clutch, world record" value={cfg.keywordText} onChange={(e) => setCfg((c) => ({ ...c, keywordText: e.target.value }))} />
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Content category">
            <select className={inputCls} value={cfg.categoryOverride} onChange={(e) => set("categoryOverride", e.target.value as AnalysisConfig["categoryOverride"])}>
              <option value="auto">Auto-detect</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Min duration (s)">
            <input type="number" min={3} className={inputCls} value={cfg.minDuration ?? ""} onChange={(e) => set("minDuration", +e.target.value)} />
          </Field>
          <Field label="Max duration (s)">
            <input type="number" min={5} className={inputCls} value={cfg.maxDuration ?? ""} onChange={(e) => set("maxDuration", +e.target.value)} />
          </Field>
          <Field label="Max clips">
            <input type="number" min={1} max={100} className={inputCls} value={cfg.maxClips ?? ""} onChange={(e) => set("maxClips", +e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={!!cfg.adaptive} onChange={(v) => set("adaptive", v)} label="Adaptive clip length" hint={`Extends each clip while the moment continues (within ${cfg.minDuration}–${cfg.maxDuration}s). Off = fixed ${cfg.targetDuration}s.`} />
          {!cfg.adaptive && (
            <Field label="Fixed duration (s)">
              <input type="number" className={inputCls} value={cfg.targetDuration ?? ""} onChange={(e) => set("targetDuration", +e.target.value)} />
            </Field>
          )}
          {media.chatCount > 0 && <Toggle checked={!!cfg.useChat} onChange={(v) => set("useChat", v)} label={`Use chat log (${media.chatCount.toLocaleString()} messages)`} />}
          {media.hasTranscript && <Toggle checked={!!cfg.retranscribe} onChange={(v) => set("retranscribe", v)} label="Re-run transcription" hint={`Existing transcript source: ${media.transcriptSource}`} />}
          <Toggle checked={!!cfg.replaceExisting} onChange={(v) => set("replaceExisting", v)} label="Replace pending AI clips" hint="Approved, rejected and manual clips are always kept." />
        </div>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">Signal weights (advanced)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {WEIGHT_LABELS.map(([k, label]) => (
              <label key={k} className="block text-xs text-muted">
                <span className="flex justify-between">
                  {label}
                  <span className="text-fg">{((cfg.weights?.[k] ?? 1) * 100).toFixed(0)}%</span>
                </span>
                <input type="range" min={0} max={2} step={0.1} className="w-full" value={cfg.weights?.[k] ?? 1} onChange={(e) => setCfg((c) => ({ ...c, weights: { ...(c.weights as AppSettings["weights"]), [k]: +e.target.value } }))} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Multipliers on top of the per-category defaults. Signals without data (e.g. chat without a chat log) are ignored automatically.</p>
        </details>
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !s}>
            <span>Start analysis</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
