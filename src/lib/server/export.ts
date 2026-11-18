import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, exportsTable, media } from "@/db/schema";
import type { Cue, ExportSettings, SubtitleStyle } from "@/lib/shared/types";
import { formatSrt } from "@/lib/shared/time";
import { outputSize, parseAspect } from "@/lib/shared/presets";
import { DEFAULT_EXPORT } from "@/lib/shared/defaults";
import { AppError, CancelledError } from "./errors";
import { assertDisk, detectHardware, pickEncoder, probe, runFFmpeg, type HardwareInfo } from "./ffmpeg";
import { dirs, ensureDirs, rmSafe, sanitizeFilename, tmpDirFor, uniquePath } from "./paths";
import { enqueueJob, type JobContext } from "./queue";
import { getSettings } from "./settings";
import type { ClipRow } from "./clips";
import type { MediaRow } from "./media";

/* ------------------------------ ASS subtitles ------------------------------ */

function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const h = m ? m[1] : "FFFFFF";
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = Math.round(Math.max(0, Math.min(255, alpha))).toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Build an ASS file; `cues` must already be relative to clip start. */
export function buildAss(cues: Cue[], style: SubtitleStyle, width: number, height: number): string {
  const k = Math.min(width, height) / 1080;
  const size = Math.max(8, Math.round(style.size * k));
  const outline = Math.max(0, style.outlineWidth * k);
  const marginV = Math.round(style.marginV * k);
  const align = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const font = style.font.replace(/[,\r\n]/g, " ").trim() || "Arial";
  const bold = style.bold ? -1 : 0;
  const boxAlpha = (1 - Math.max(0, Math.min(1, style.bgOpacity))) * 255;
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Text,${font},${size},${assColor(style.color)},&H000000FF,${assColor(style.outlineColor)},&H00000000,${bold},0,0,0,100,100,0,0,1,${outline.toFixed(1)},0,${align},${Math.round(60 * k)},${Math.round(60 * k)},${marginV},1`,
    `Style: Box,${font},${size},&HFF000000,&H000000FF,${assColor(style.bgColor, boxAlpha)},&H00000000,${bold},0,0,0,100,100,0,0,3,${Math.round(14 * k)},0,${align},${Math.round(60 * k)},${Math.round(60 * k)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const c of cues) {
    let text = c.text.trim().replace(/\r/g, "").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
    if (style.uppercase) text = text.toUpperCase();
    if (!text) continue;
    if (style.bgOpacity > 0) lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Box,,0,0,0,,${text}`);
    lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Text,,0,0,0,,${text}`);
  }
  return lines.join("\n") + "\n";
}

/* ------------------------------ FFmpeg command ------------------------------ */

export interface RenderPlan {
  args: string[];
  width: number;
  height: number;
  duration: number;
  outDuration: number;
}

export function clipRelativeCues(clip: ClipRow): Cue[] {
  const dur = clip.endSec - clip.startSec;
  return (clip.subtitles?.cues ?? [])
    .map((c) => ({ start: Math.max(0, c.start - clip.startSec), end: Math.min(dur, c.end - clip.startSec), text: c.text }))
    .filter((c) => c.end > c.start && c.text.trim())
    .sort((a, b) => a.start - b.start);
}

export function planRender(p: {
  clip: ClipRow;
  media: MediaRow;
  source: string;
  settings: ExportSettings;
  encoderName: string;
  out: string;
  assName?: string;
  softSrt?: string;
  preview?: boolean;
}): RenderPlan {
  const { clip, media: m, settings: s } = p;
  const aspect = parseAspect(s.aspect === "clip" ? clip.aspect : s.aspect) ?? 9 / 16;
  const { width, height } = outputSize(aspect, p.preview ? 360 : s.resolution);
  const dur = clip.endSec - clip.startSec;
  if (dur <= 0.1) throw new AppError("bad_clip", "This clip has no duration. Adjust its start and end times.");
  const fps = p.preview ? 30 : s.fps;
  const crop = clip.crop;
  const A = aspect.toFixed(5);
  const z = Math.max(1, crop.zoom).toFixed(3);

  const inputs: string[] = [];
  let videoChain: string;
  let audioMap: string | null;
  if (m.hasVideo) {
    inputs.push("-ss", clip.startSec.toFixed(3), "-i", p.source);
    if (crop.mode === "blur") {
      videoChain =
        `[0:v]split[a][b];[a]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:3[bg];` +
        `[b]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
    } else {
      videoChain =
        `[0:v]crop=w='trunc(min(iw\\,ih*${A})/${z}/2)*2':h='trunc(min(iw\\,ih*${A})/${z}/${A}/2)*2':x='(iw-ow)*${crop.x.toFixed(4)}':y='(ih-oh)*${crop.y.toFixed(4)}',` +
        `scale=${width}:${height}:flags=lanczos,setsar=1`;
    }
    audioMap = m.hasAudio ? "0:a:0" : null;
  } else {
    inputs.push("-f", "lavfi", "-i", `color=c=0x0b0d12:s=${width}x${height}:r=${fps || 30}:d=${dur.toFixed(3)}`, "-ss", clip.startSec.toFixed(3), "-i", p.source);
    videoChain = "[0:v]null";
    audioMap = "1:a:0";
  }
  if (fps > 0) videoChain += `,fps=${fps}`;
  if (p.assName) videoChain += `,ass=${p.assName}`;
  videoChain += ",format=yuv420p[vout]";

  const args: string[] = ["-y", ...inputs];
  const softIndex = m.hasVideo ? 1 : 2;
  if (p.softSrt) args.push("-i", p.softSrt);
  args.push("-t", dur.toFixed(3), "-filter_complex", videoChain, "-map", "[vout]");

  const a = clip.audio;
  if (audioMap && !a.mute) {
    const af: string[] = [];
    if (a.normalize) af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    if (Math.abs(a.volume - 1) > 0.01) af.push(`volume=${Math.max(0, Math.min(4, a.volume)).toFixed(3)}`);
    if (a.fadeIn > 0) af.push(`afade=t=in:st=0:d=${Math.min(a.fadeIn, dur).toFixed(2)}`);
    if (a.fadeOut > 0) af.push(`afade=t=out:st=${Math.max(0, dur - a.fadeOut).toFixed(2)}:d=${Math.min(a.fadeOut, dur).toFixed(2)}`);
    args.push("-map", audioMap);
    if (af.length) args.push("-af", af.join(","));
  } else args.push("-an");
  if (p.softSrt) args.push("-map", `${softIndex}:0`, "-c:s", s.format === "mkv" ? "srt" : "mov_text", "-metadata:s:s:0", "language=eng");

  // video codec
  const enc = p.encoderName;
  const br = p.preview ? 0 : s.videoBitrate;
  const rate = (crf: number) => (br > 0 ? ["-b:v", `${br}k`, "-maxrate", `${Math.round(br * 1.5)}k`, "-bufsize", `${br * 2}k`] : ["-crf", String(crf)]);
  if (p.preview) args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p");
  else if (enc === "libx264") args.push("-c:v", enc, "-preset", "medium", ...rate(20), "-pix_fmt", "yuv420p");
  else if (enc === "h264_nvenc") args.push("-c:v", enc, "-preset", "p5", "-rc", "vbr", ...(br > 0 ? ["-b:v", `${br}k`, "-maxrate", `${Math.round(br * 1.5)}k`] : ["-cq", "23", "-b:v", "0"]), "-pix_fmt", "yuv420p");
  else if (enc === "libx265") args.push("-c:v", enc, "-preset", "medium", ...rate(24), "-tag:v", "hvc1", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p");
  else if (enc === "hevc_nvenc") args.push("-c:v", enc, "-preset", "p5", "-rc", "vbr", ...(br > 0 ? ["-b:v", `${br}k`] : ["-cq", "26", "-b:v", "0"]), "-tag:v", "hvc1", "-pix_fmt", "yuv420p");
  else if (enc === "libvpx-vp9") args.push("-c:v", enc, "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", ...(br > 0 ? ["-b:v", `${br}k`] : ["-crf", "32", "-b:v", "0"]), "-pix_fmt", "yuv420p");
  else if (enc === "libsvtav1") args.push("-c:v", enc, "-preset", "8", ...(br > 0 ? ["-b:v", `${br}k`] : ["-crf", "32"]), "-pix_fmt", "yuv420p");
  else if (enc === "libaom-av1") args.push("-c:v", enc, "-cpu-used", "6", "-row-mt", "1", ...(br > 0 ? ["-b:v", `${br}k`] : ["-crf", "32", "-b:v", "0"]), "-pix_fmt", "yuv420p");
  else args.push("-c:v", enc, ...(br > 0 ? ["-b:v", `${br}k`] : []), "-pix_fmt", "yuv420p");

  // audio codec
  if (audioMap && !a.mute) {
    if (s.format === "webm") args.push("-c:a", "libopus", "-b:a", `${p.preview ? 96 : s.audioBitrate}k`, "-ar", "48000");
    else args.push("-c:a", "aac", "-b:a", `${p.preview ? 96 : s.audioBitrate}k`, "-ar", "48000");
  }
  if (s.format === "mp4" || s.format === "mov" || p.preview) args.push("-movflags", "+faststart");
  args.push(p.out);
  return { args, width, height, duration: dur, outDuration: dur };
}

export function validateFormat(s: ExportSettings): void {
  if (s.format === "webm" && !["vp9", "av1"].includes(s.codec))
    throw new AppError("bad_format", "WebM supports only VP9 or AV1. Choose one of those codecs or switch to MP4/MKV.");
  if ((s.format === "mp4" || s.format === "mov") && s.codec === "vp9")
    throw new AppError("bad_format", "VP9 is not supported in MP4/MOV here. Use WebM or MKV for VP9.");
  if (s.subtitleMode === "soft" && s.format === "webm")
    throw new AppError("bad_format", "Soft subtitle tracks are not supported in WebM. Use burn-in, MP4 or MKV.");
}

/* --------------------------------- export job --------------------------------- */

function resolveOutDir(s: ExportSettings, projectId: number): string {
  ensureDirs();
  const dir = s.outputDir.trim() ? s.outputDir.trim() : path.join(dirs.exports, String(projectId));
  if (!path.isAbsolute(dir)) throw new AppError("output_dir", "The output folder must be an absolute path.");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    throw new AppError("output_dir", `The output folder is not writable: ${dir}. ${e instanceof Error ? e.message : ""}`, { hint: "Choose another folder in Export settings." });
  }
  return dir;
}

export async function queueExports(clipIds: number[], settings: ExportSettings): Promise<number[]> {
  validateFormat(settings);
  const out: number[] = [];
  for (const id of clipIds) {
    const [c] = await db.select().from(clips).where(eq(clips.id, id));
    if (!c) continue;
    const [exp] = await db
      .insert(exportsTable)
      .values({ clipId: c.id, projectId: c.projectId, title: c.title, settings: { ...DEFAULT_EXPORT, ...settings }, durationSec: c.endSec - c.startSec })
      .returning();
    const job = await enqueueJob({ type: "export", projectId: c.projectId, mediaId: c.mediaId, clipId: c.id, config: { exportId: exp.id } });
    await db.update(exportsTable).set({ jobId: job.id }).where(eq(exportsTable.id, exp.id));
    out.push(exp.id);
  }
  return out;
}

export async function runExportJob(ctx: JobContext): Promise<void> {
  const exportId = Number((ctx.job.config as { exportId: number }).exportId);
  const [exp] = await db.select().from(exportsTable).where(eq(exportsTable.id, exportId));
  if (!exp) throw new AppError("not_found", "Export record not found.", { status: 404 });
  let outPath: string | null = null;
  let tmp: string | null = null;
  try {
    await db.update(exportsTable).set({ status: "running", error: null }).where(eq(exportsTable.id, exp.id));
    if (!exp.clipId) throw new AppError("clip_deleted", "The clip for this export was deleted.");
    const [clip] = await db.select().from(clips).where(eq(clips.id, exp.clipId));
    if (!clip) throw new AppError("clip_deleted", "The clip for this export was deleted.");
    const [m] = await db.select().from(media).where(eq(media.id, clip.mediaId));
    if (!m || !fs.existsSync(m.filePath)) throw new AppError("file_missing", "The source media file is missing. Re-import it to export this clip.");
    const s = exp.settings;
    validateFormat(s);
    const app = await getSettings();
    const hw: HardwareInfo = await detectHardware();
    const allowGpu = s.hardware === "auto" && app.processing.gpu === "auto";
    let encoder = pickEncoder(s.codec, hw, allowGpu);

    const outDir = resolveOutDir(s, exp.projectId);
    const dur = clip.endSec - clip.startSec;
    await assertDisk(outDir, ((s.videoBitrate || 8000) + s.audioBitrate) * 125 * dur * 1.3 + 50e6);
    tmp = tmpDirFor(`export-${exp.id}`);

    const aspectLabel = (s.aspect === "clip" ? clip.aspect : s.aspect).replace(/[:/]/g, "x");
    const ext = `.${s.format}`;
    outPath = uniquePath(outDir, `${sanitizeFilename(clip.title, `clip-${clip.id}`).slice(0, 80)} - ${aspectLabel}`, ext);
    const partial = `${outPath}.partial${ext}`;

    const cues = clip.subtitles?.enabled ? clipRelativeCues(clip) : [];
    let assName: string | undefined;
    let softSrt: string | undefined;
    const plan0 = planRender({ clip, media: m, source: m.filePath, settings: s, encoderName: encoder.name, out: partial });
    if (cues.length && s.subtitleMode === "burn") {
      assName = "subs.ass";
      fs.writeFileSync(path.join(tmp, assName), buildAss(cues, clip.subtitles.style, plan0.width, plan0.height), "utf8");
    }
    if (cues.length && s.subtitleMode === "soft") {
      softSrt = path.join(tmp, "subs.srt");
      fs.writeFileSync(softSrt, formatSrt(cues), "utf8");
    }
    let srtPath: string | null = null;
    if (cues.length && s.exportSrt) {
      srtPath = outPath.replace(/\.[^.]+$/, ".srt");
      fs.writeFileSync(srtPath, formatSrt(cues), "utf8");
    }
    ctx.log("info", `Encoder: ${encoder.name}${encoder.gpu ? " (GPU)" : " (CPU)"} · ${plan0.width}×${plan0.height}`);

    const run = async (encName: string) => {
      const plan = planRender({ clip, media: m, source: m.filePath, settings: s, encoderName: encName, out: partial, assName, softSrt });
      ctx.update({ stage: "Rendering", message: path.basename(outPath!) });
      await runFFmpeg(plan.args, { signal: ctx.signal, cwd: tmp!, onProgress: (t) => ctx.update({ progress: Math.min(0.97, t / plan.duration) }) });
    };
    try {
      await run(encoder.name);
    } catch (e) {
      if (e instanceof CancelledError || !encoder.gpu) throw e;
      ctx.log("warn", `GPU encoding failed (${e instanceof Error ? e.message : e}). Retrying on CPU…`);
      rmSafe(partial);
      encoder = pickEncoder(s.codec, hw, false);
      await run(encoder.name);
    }
    ctx.update({ stage: "Verifying output", progress: 0.98 });
    const info = await probe(partial).catch(() => {
      throw new AppError("verify_failed", "The exported file could not be read back — the export failed.");
    });
    if (Math.abs(info.duration - dur) > Math.max(0.6, dur * 0.03))
      throw new AppError("verify_failed", `Exported duration (${info.duration.toFixed(1)}s) does not match the clip (${dur.toFixed(1)}s).`);
    fs.renameSync(partial, outPath);
    const size = fs.statSync(outPath).size;
    await db.update(exportsTable).set({ status: "completed", filePath: outPath, srtPath, sizeBytes: size, durationSec: info.duration }).where(eq(exportsTable.id, exp.id));
    ctx.setResult({ exportId: exp.id, filePath: outPath, sizeBytes: size });
  } catch (e) {
    if (outPath) {
      rmSafe(`${outPath}.partial${path.extname(outPath)}`);
    }
    const cancelled = e instanceof CancelledError || ctx.signal.aborted;
    await db
      .update(exportsTable)
      .set({ status: cancelled ? "cancelled" : "failed", error: cancelled ? null : e instanceof Error ? e.message : String(e) })
      .where(eq(exportsTable.id, exp.id));
    throw e;
  } finally {
    rmSafe(tmp);
  }
}

/* ---------------------------------- preview ---------------------------------- */

export async function renderClipPreview(clipId: number): Promise<string> {
  const [clip] = await db.select().from(clips).where(eq(clips.id, clipId));
  if (!clip) throw new AppError("not_found", "Clip not found", { status: 404 });
  const [m] = await db.select().from(media).where(eq(media.id, clip.mediaId));
  if (!m || !fs.existsSync(m.filePath)) throw new AppError("file_missing", "The source media file is missing.");
  ensureDirs();
  const key = crypto
    .createHash("sha1")
    .update(JSON.stringify([clip.startSec, clip.endSec, clip.aspect, clip.crop, clip.audio, clip.subtitles, m.id, !!m.proxyPath]))
    .digest("hex")
    .slice(0, 12);
  const out = path.join(dirs.previews, `clip-${clip.id}-${key}.mp4`);
  if (fs.existsSync(out)) return out;
  for (const f of fs.readdirSync(dirs.previews)) if (f.startsWith(`clip-${clip.id}-`)) rmSafe(path.join(dirs.previews, f));
  const settings: ExportSettings = { ...DEFAULT_EXPORT, aspect: "clip", fps: 30, videoBitrate: 0, format: "mp4", codec: "h264" };
  const source = m.proxyPath && fs.existsSync(m.proxyPath) ? m.proxyPath : m.filePath;
  const tmp = tmpDirFor(`preview-${clip.id}`);
  try {
    const cues = clip.subtitles?.enabled ? clipRelativeCues(clip) : [];
    const probePlan = planRender({ clip, media: m, source, settings, encoderName: "libx264", out, preview: true });
    let assName: string | undefined;
    if (cues.length) {
      assName = "subs.ass";
      fs.writeFileSync(path.join(tmp, assName), buildAss(cues, clip.subtitles.style, probePlan.width, probePlan.height), "utf8");
    }
    const plan = planRender({ clip, media: m, source, settings, encoderName: "libx264", out: `${out}.tmp.mp4`, assName, preview: true });
    await runFFmpeg(plan.args, { cwd: tmp, timeoutMs: 180_000 });
    fs.renameSync(`${out}.tmp.mp4`, out);
    return out;
  } finally {
    rmSafe(tmp);
    rmSafe(`${out}.tmp.mp4`);
  }
}
