"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBanner, Field, Icon, Notice, PageHeader, Spinner, Toggle, inputCls } from "@/components/ui";
import { api, errMsg, toast, useApi, type SystemInfo } from "@/lib/client/api";
import { DEFAULT_SETTINGS } from "@/lib/shared/defaults";
import { fmtBytes } from "@/lib/shared/time";
import type { AppSettings } from "@/lib/shared/types";

type KeyStatus = Record<string, { set: boolean; masked: string }>;

const PRESETS: { label: string; baseUrl: string; local?: boolean }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", local: true },
  { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", local: true },
  { label: "faster-whisper-server / whisper.cpp server (local)", baseUrl: "http://localhost:8000/v1", local: true },
];

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Icon name={icon} className="h-4 w-4 text-accent" /> {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function ProviderTest({ target, ensureSaved }: { target: "llm" | "transcription"; ensureSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy("test");
    setRes(null);
    try {
      await ensureSaved();
      const r = await api<{ detail: string; ms: number }>("/api/settings/test", { method: "POST", json: { action: "test", target } });
      setRes({ ok: true, text: `${r.detail} (${r.ms} ms)` });
    } catch (e) {
      setRes({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <Button size="sm" onClick={run} disabled={!!busy}>
        {busy ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3.5 w-3.5" />} Save & test connection
      </Button>
      {res && <p className={`text-xs ${res.ok ? "text-emerald-400" : "text-rose-400"}`}>{res.text}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { data, reload } = useApi<{ settings: AppSettings; keys: KeyStatus }>("/api/settings");
  const { data: sys } = useApi<SystemInfo>("/api/system");
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [keys, setKeys] = useState<{ transcription: string; llm: string }>({ transcription: "", llm: "" });
  const [clear, setClear] = useState<{ transcription: boolean; llm: boolean }>({ transcription: false, llm: false });
  const [models, setModels] = useState<{ llm: string[]; transcription: string[] }>({ llm: [], transcription: [] });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  const up = <K extends keyof AppSettings>(k: K, patch: Partial<AppSettings[K]>) => setS((x) => ({ ...x, [k]: { ...(x[k] as object), ...patch } as AppSettings[K] }));

  const save = async (quiet = false) => {
    setSaving(true);
    try {
      const k: Record<string, string | null> = {};
      (["transcription", "llm"] as const).forEach((n) => {
        if (clear[n]) k[n] = null;
        else if (keys[n].trim()) k[n] = keys[n].trim();
      });
      await api("/api/settings", { method: "PUT", json: { settings: s, keys: k } });
      setKeys({ transcription: "", llm: "" });
      setClear({ transcription: false, llm: false });
      localStorage.setItem("clippahh-theme", s.appearance.theme);
      document.documentElement.dataset.theme = s.appearance.theme;
      await reload();
      if (!quiet) toast("Settings saved", "success");
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const fetchModels = async (target: "llm" | "transcription") => {
    try {
      await save(true);
      const r = await api<{ models: string[] }>("/api/settings/test", { method: "POST", json: { action: "models", target } });
      setModels((m) => ({ ...m, [target]: r.models }));
      toast(`${r.models.length} models found`, "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const keyField = (n: "transcription" | "llm") => {
    const st = data?.keys[n];
    return (
      <Field label="API key" hint={st?.set ? `Stored encrypted on this PC (${st.masked}). Never shown again or logged.` : "Stored encrypted on this PC. Not needed for local servers."}>
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            className={inputCls}
            placeholder={st?.set && !clear[n] ? "•••••••• (saved — type to replace)" : "Paste key"}
            value={keys[n]}
            onChange={(e) => setKeys((k) => ({ ...k, [n]: e.target.value }))}
          />
          {st?.set && (
            <Button size="sm" variant={clear[n] ? "danger" : "default"} onClick={() => setClear((c) => ({ ...c, [n]: !c[n] }))}>
              {clear[n] ? "Will remove" : "Remove"}
            </Button>
          )}
        </div>
      </Field>
    );
  };

  const hw = sys?.hardware;

  return (
    <>
      <PageHeader title="Settings" subtitle="Providers are replaceable — nothing is hardcoded. Process locally wherever you can.">
        <Button variant="primary" onClick={() => save().catch(() => undefined)} disabled={saving}>
          {saving ? <Spinner /> : <Icon name="check" />} Save settings
        </Button>
      </PageHeader>
      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Section title="Speech recognition (transcripts & subtitles)" icon="mic">
          <Field label="Provider">
            <select className={inputCls} value={s.transcription.provider} onChange={(e) => up("transcription", { provider: e.target.value as AppSettings["transcription"]["provider"] })}>
              <option value="none">Disabled (use imported .srt only)</option>
              <option value="openai-compatible">OpenAI-compatible API (cloud or local server)</option>
              <option value="whisper-cpp">whisper.cpp (fully local, no API)</option>
            </select>
          </Field>
          {s.transcription.provider === "openai-compatible" && (
            <>
              <Field label="Quick fill" hint="Any server implementing /audio/transcriptions works.">
                <select className={inputCls} value="" onChange={(e) => e.target.value && up("transcription", { baseUrl: e.target.value })}>
                  <option value="">Choose a preset…</option>
                  {PRESETS.map((p) => (
                    <option key={p.baseUrl} value={p.baseUrl}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Base URL">
                <input className={inputCls} value={s.transcription.baseUrl} onChange={(e) => up("transcription", { baseUrl: e.target.value })} />
              </Field>
              <Field label="Model" hint="Type a model name or fetch the list your provider currently offers.">
                <div className="flex gap-2">
                  <input className={inputCls} list="tr-models" value={s.transcription.model} onChange={(e) => up("transcription", { model: e.target.value })} placeholder="e.g. a Whisper-class transcription model" />
                  <datalist id="tr-models">{models.transcription.map((m) => <option key={m} value={m} />)}</datalist>
                  <Button size="sm" onClick={() => fetchModels("transcription")}>Fetch list</Button>
                </div>
              </Field>
              {keyField("transcription")}
            </>
          )}
          {s.transcription.provider === "whisper-cpp" && (
            <>
              <Field label="whisper.cpp executable" hint="Path to whisper-cli(.exe) from a whisper.cpp release (CUDA builds use your NVIDIA GPU).">
                <input className={inputCls} placeholder="C:\tools\whisper\whisper-cli.exe" value={s.transcription.whisperBinary} onChange={(e) => up("transcription", { whisperBinary: e.target.value })} />
              </Field>
              <Field label="Model file (.bin)">
                <input className={inputCls} placeholder="C:\tools\whisper\ggml-base.en.bin" value={s.transcription.whisperModel} onChange={(e) => up("transcription", { whisperModel: e.target.value })} />
              </Field>
            </>
          )}
          {s.transcription.provider !== "none" && (
            <Field label="Spoken language" hint="Leave empty for auto-detect, or use an ISO code (en, es, de…).">
              <input className={inputCls} value={s.transcription.language} onChange={(e) => up("transcription", { language: e.target.value.trim() })} placeholder="auto" />
            </Field>
          )}
          {s.transcription.provider !== "none" && <ProviderTest target="transcription" ensureSaved={() => save(true)} />}
        </Section>

        <Section title="Semantic understanding (LLM)" icon="sparkles">
          <Field label="Provider">
            <select className={inputCls} value={s.llm.provider} onChange={(e) => up("llm", { provider: e.target.value as AppSettings["llm"]["provider"] })}>
              <option value="heuristic">Built-in rule-based analyzer (offline)</option>
              <option value="openai-compatible">OpenAI-compatible API (cloud or local, e.g. Ollama)</option>
              <option value="anthropic">Anthropic API</option>
            </select>
          </Field>
          {s.llm.provider !== "heuristic" && (
            <>
              {s.llm.provider === "openai-compatible" && (
                <>
                  <Field label="Quick fill">
                    <select className={inputCls} value="" onChange={(e) => e.target.value && up("llm", { baseUrl: e.target.value })}>
                      <option value="">Choose a preset…</option>
                      {PRESETS.slice(0, 5).map((p) => (
                        <option key={p.baseUrl} value={p.baseUrl}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Base URL">
                    <input className={inputCls} value={s.llm.baseUrl} onChange={(e) => up("llm", { baseUrl: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label="Model" hint="Fetch the current list from your provider instead of relying on built-in names.">
                <div className="flex gap-2">
                  <input className={inputCls} list="llm-models" value={s.llm.model} onChange={(e) => up("llm", { model: e.target.value })} />
                  <datalist id="llm-models">{models.llm.map((m) => <option key={m} value={m} />)}</datalist>
                  <Button size="sm" onClick={() => fetchModels("llm")}>Fetch list</Button>
                </div>
              </Field>
              {keyField("llm")}
              <Toggle checked={s.llm.useVision} onChange={(v) => up("llm", { useVision: v })} label="Vision review of top candidates" hint="Sends up to 8 video frames to the model to describe visible reactions/events. Requires a vision-capable model." />
              {s.llm.useVision && (
                <Field label="Vision model (optional)" hint="Defaults to the model above.">
                  <input className={inputCls} value={s.llm.visionModel} onChange={(e) => up("llm", { visionModel: e.target.value })} />
                </Field>
              )}
              <ProviderTest target="llm" ensureSaved={() => save(true)} />
            </>
          )}
        </Section>

        <Section title="Privacy" icon="shield">
          <Toggle
            checked={s.privacy.allowCloud}
            onChange={(v) => up("privacy", { allowCloud: v })}
            label="Allow sending data to cloud AI providers"
            hint="When off (default), any provider that isn’t on this computer is blocked. When on: the audio track is sent to the transcription provider, transcript text to the LLM, and optionally video frames to the vision model. Videos themselves are never uploaded."
          />
          <Toggle checked={s.privacy.keepTempFiles} onChange={(v) => up("privacy", { keepTempFiles: v })} label="Keep temporary analysis files" hint="For debugging only. Temporary files are normally deleted when a job finishes." />
          {!s.privacy.allowCloud && s.transcription.provider === "openai-compatible" && !/localhost|127\.0\.0\.1/.test(s.transcription.baseUrl) && <Notice tone="warn">Your transcription provider is remote, but cloud sending is off — analysis will be blocked until you enable it above or choose a local provider.</Notice>}
        </Section>

        <Section title="Clip defaults" icon="scissors">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Min (s)"><input type="number" className={inputCls} value={s.clips.minDuration} onChange={(e) => up("clips", { minDuration: +e.target.value })} /></Field>
            <Field label="Target (s)"><input type="number" className={inputCls} value={s.clips.targetDuration} onChange={(e) => up("clips", { targetDuration: +e.target.value })} /></Field>
            <Field label="Max (s)"><input type="number" className={inputCls} value={s.clips.maxDuration} onChange={(e) => up("clips", { maxDuration: +e.target.value })} /></Field>
          </div>
          <Field label="Max clips per analysis"><input type="number" className={inputCls} value={s.clips.maxClips} onChange={(e) => up("clips", { maxClips: +e.target.value })} /></Field>
          <Toggle checked={s.clips.adaptive} onChange={(v) => up("clips", { adaptive: v })} label="Adaptive clip length" hint="Clips grow or shrink with the moment, within the min/max limits." />
        </Section>

        <Section title="Processing & hardware" icon="settings">
          <Field label="GPU acceleration" hint={hw?.nvenc ? `NVENC available on ${hw.gpuName ?? "your GPU"}. Falls back to CPU automatically if it fails.` : "No NVIDIA encoder detected; CPU encoding is used."}>
            <select className={inputCls} value={s.processing.gpu} onChange={(e) => up("processing", { gpu: e.target.value as "auto" | "off" })}>
              <option value="auto">Auto (use GPU when available)</option>
              <option value="off">Off (CPU only)</option>
            </select>
          </Field>
          <Field label="Simultaneous background jobs" hint="1 is recommended on gaming PCs so games and exports don’t compete.">
            <select className={inputCls} value={s.processing.concurrency} onChange={(e) => up("processing", { concurrency: +e.target.value })}>
              {[1, 2, 3].map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Toggle checked={s.processing.autoProxy} onChange={(v) => up("processing", { autoProxy: v })} label="Create preview proxies automatically" hint="For formats browsers can’t play (HEVC, MKV, AVI…), a 720p H.264 proxy is made for smooth preview. Exports always use the original." />
          <div className="rounded-lg bg-bg p-3 text-xs text-muted">
            {hw ? (
              <ul className="space-y-1">
                <li>FFmpeg: {hw.ffmpeg ? <>{hw.ffmpeg.version} <Badge>{hw.ffmpeg.source}</Badge></> : <span className="text-rose-400">not found</span>} · FFprobe: {hw.ffprobe ? "ok" : <span className="text-rose-400">not found</span>}</li>
                <li>CPU cores: {hw.cpuCores} · RAM: {hw.memGB} GB · {hw.platform}</li>
                <li>H.264: {hw.encoders.h264.join(", ") || "—"} · HEVC: {hw.encoders.hevc.join(", ") || "—"}</li>
                <li>VP9: {hw.encoders.vp9.join(", ") || "—"} · AV1: {hw.encoders.av1.join(", ") || "—"}</li>
                <li>GPU encoding: {hw.nvenc ? <span className="text-emerald-400">NVENC working</span> : "unavailable"}</li>
                <li>Data folder: <span className="font-mono">{sys?.dataDir}</span> · {fmtBytes(sys?.diskFreeBytes ?? 0)} free</li>
              </ul>
            ) : (
              "Detecting hardware…"
            )}
          </div>
        </Section>

        <Section title="Export & subtitle defaults" icon="download">
          <Field label="Default output folder" hint="Absolute path. Empty = managed exports folder inside the data directory.">
            <input className={inputCls} value={s.export.outputDir} onChange={(e) => up("export", { outputDir: e.target.value })} placeholder="C:\Users\you\Videos\Clippahh" />
          </Field>
          <p className="text-xs text-muted">Preset, codec, resolution, frame rate and bitrate defaults are set in the Export Manager (“Save default”). Subtitle style defaults apply to newly generated clips:</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Font"><input className={inputCls} value={s.subtitles.font} onChange={(e) => up("subtitles", { font: e.target.value })} /></Field>
            <Field label="Size"><input type="number" className={inputCls} value={s.subtitles.size} onChange={(e) => up("subtitles", { size: +e.target.value })} /></Field>
            <Field label="Text color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-bg" value={s.subtitles.color} onChange={(e) => up("subtitles", { color: e.target.value })} /></Field>
            <Field label="Outline color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-bg" value={s.subtitles.outlineColor} onChange={(e) => up("subtitles", { outlineColor: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="Scoring weights" icon="star">
          <p className="text-xs text-muted">Multipliers applied on top of each content category’s built-in balance. Signals with no data are ignored.</p>
          {(Object.keys(s.weights) as (keyof AppSettings["weights"])[]).map((k) => (
            <label key={k} className="block text-xs">
              <span className="flex justify-between capitalize text-muted">{k}<span className="text-fg">{Math.round(s.weights[k] * 100)}%</span></span>
              <input type="range" min={0} max={2} step={0.1} className="w-full" value={s.weights[k]} onChange={(e) => up("weights", { [k]: +e.target.value })} />
            </label>
          ))}
        </Section>

        <Section title="Sources & appearance" icon="link">
          <Field label="yt-dlp path (optional)" hint={sys?.ytDlp ? "yt-dlp detected." : "Only needed to import platform links (YouTube, Twitch, Kick, TikTok, Instagram) for content you’re permitted to use."}>
            <input className={inputCls} value={s.sources.ytDlpPath} onChange={(e) => up("sources", { ytDlpPath: e.target.value })} placeholder="C:\tools\yt-dlp.exe" />
          </Field>
          <Field label="Theme">
            <select className={inputCls} value={s.appearance.theme} onChange={(e) => up("appearance", { theme: e.target.value as "dark" | "light" })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </Section>
      </div>
    </>
  );
}
