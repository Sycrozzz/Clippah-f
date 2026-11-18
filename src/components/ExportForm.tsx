"use client";
import { Field, inputCls, Toggle, Notice } from "./ui";
import { ASPECT_OPTIONS, EXPORT_PRESETS, applyPreset, parseAspect } from "@/lib/shared/presets";
import type { ExportSettings } from "@/lib/shared/types";
import type { SystemInfo } from "@/lib/client/api";

export default function ExportForm({ value, onChange, sys, durations = [] }: { value: ExportSettings; onChange: (v: ExportSettings) => void; sys: SystemInfo | null; durations?: number[] }) {
  const set = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]) => onChange({ ...value, [k]: v, preset: k === "preset" ? (v as string) : "custom" });
  const preset = EXPORT_PRESETS.find((p) => p.id === value.preset);
  const enc = sys?.hardware.encoders;
  const avail = (c: ExportSettings["codec"]) => (enc ? enc[c].length > 0 : c === "h264");
  const customAspect = value.aspect !== "clip" && !ASPECT_OPTIONS.includes(value.aspect);
  const tooLong = preset?.recommendedMaxSec ? durations.filter((d) => d > preset.recommendedMaxSec!).length : 0;
  const aspectValid = value.aspect === "clip" || parseAspect(value.aspect) !== null;

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted">Preset</span>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(applyPreset(value, p.id))}
              className={`rounded-lg border px-3 py-2 text-left transition ${value.preset === p.id ? "border-accent bg-accent/10" : "border-line hover:border-accent/40"}`}
            >
              <div className="text-sm font-medium">{p.label}</div>
              <div className="text-[11px] text-muted">{p.description}</div>
            </button>
          ))}
        </div>
      </div>
      {tooLong > 0 && preset?.recommendedMaxSec && (
        <Notice tone="warn">
          {tooLong} selected clip{tooLong > 1 ? "s are" : " is"} longer than the commonly recommended {preset.recommendedMaxSec}s for {preset.label}. Platform limits change — check the platform’s current rules.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Aspect ratio">
          <select
            className={inputCls}
            value={customAspect ? "custom" : value.aspect}
            onChange={(e) => set("aspect", e.target.value === "custom" ? "21:9" : e.target.value)}
          >
            <option value="clip">Per clip (as edited)</option>
            {ASPECT_OPTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </Field>
        {customAspect ? (
          <Field label="Custom ratio (W:H)" hint={aspectValid ? undefined : "Use a format like 21:9"}>
            <input className={inputCls} value={value.aspect} onChange={(e) => set("aspect", e.target.value)} />
          </Field>
        ) : (
          <Field label="Resolution (short edge)">
            <select className={inputCls} value={value.resolution} onChange={(e) => set("resolution", +e.target.value)}>
              {[540, 720, 1080, 1440, 2160].map((r) => (
                <option key={r} value={r}>
                  {r}p
                </option>
              ))}
            </select>
          </Field>
        )}
        {customAspect && (
          <Field label="Resolution (short edge)">
            <select className={inputCls} value={value.resolution} onChange={(e) => set("resolution", +e.target.value)}>
              {[540, 720, 1080, 1440, 2160].map((r) => (
                <option key={r} value={r}>
                  {r}p
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Frame rate">
          <select className={inputCls} value={value.fps} onChange={(e) => set("fps", +e.target.value)}>
            <option value={0}>Source</option>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </Field>
        <Field label="Codec">
          <select className={inputCls} value={value.codec} onChange={(e) => set("codec", e.target.value as ExportSettings["codec"])}>
            <option value="h264" disabled={!avail("h264")}>H.264 (AVC)</option>
            <option value="hevc" disabled={!avail("hevc")}>H.265 (HEVC){avail("hevc") ? "" : " — unavailable"}</option>
            <option value="vp9" disabled={!avail("vp9")}>VP9{avail("vp9") ? "" : " — unavailable"}</option>
            <option value="av1" disabled={!avail("av1")}>AV1{avail("av1") ? "" : " — unavailable"}</option>
          </select>
        </Field>
        <Field label="Container">
          <select className={inputCls} value={value.format} onChange={(e) => set("format", e.target.value as ExportSettings["format"])}>
            {["mp4", "mov", "mkv", "webm"].map((f) => (
              <option key={f} value={f}>
                .{f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Video bitrate (kbps)" hint="0 = automatic quality (CRF)">
          <input type="number" min={0} step={500} className={inputCls} value={value.videoBitrate} onChange={(e) => set("videoBitrate", Math.max(0, +e.target.value))} />
        </Field>
        <Field label="Audio quality">
          <select className={inputCls} value={value.audioBitrate} onChange={(e) => set("audioBitrate", +e.target.value)}>
            {[96, 128, 192, 256, 320].map((b) => (
              <option key={b} value={b}>
                {b} kbps
              </option>
            ))}
          </select>
        </Field>
        <Field label="Encoder" hint={sys?.hardware.nvenc ? `NVIDIA GPU detected (${sys.hardware.gpuName ?? "NVENC"})` : "No GPU encoder detected — CPU is used"}>
          <select className={inputCls} value={value.hardware} onChange={(e) => set("hardware", e.target.value as ExportSettings["hardware"])}>
            <option value="auto">Auto (GPU if available)</option>
            <option value="cpu">CPU only</option>
          </select>
        </Field>
        <Field label="Subtitles">
          <select className={inputCls} value={value.subtitleMode} onChange={(e) => set("subtitleMode", e.target.value as ExportSettings["subtitleMode"])}>
            <option value="burn">Burned into video</option>
            <option value="soft">Soft track (MP4/MKV)</option>
            <option value="none">None</option>
          </select>
        </Field>
      </div>
      <Toggle checked={value.exportSrt} onChange={(v) => set("exportSrt", v)} label="Also export a separate .srt file" />
      <Field label="Output folder" hint="Absolute path. Leave empty to use Clippahh’s managed exports folder.">
        <input className={inputCls} placeholder="C:\Users\you\Videos\Clippahh" value={value.outputDir} onChange={(e) => set("outputDir", e.target.value)} />
      </Field>
    </div>
  );
}
