import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { AppError, CancelledError } from "./errors";

function resolveBinary(envName: string, bundled: string | null | undefined, pathName: string): { path: string; source: string } | null {
  const env = process.env[envName];
  if (env && fs.existsSync(env)) return { path: env, source: "env" };
  if (bundled && fs.existsSync(bundled)) return { path: bundled, source: "bundled" };
  const r = spawnSync(pathName, ["-version"], { stdio: "ignore" });
  if (r.status === 0) return { path: pathName, source: "system PATH" };
  return null;
}

let ffmpegBin: { path: string; source: string } | null | undefined;
let ffprobeBin: { path: string; source: string } | null | undefined;

export function getFfmpeg(): string {
  if (ffmpegBin === undefined) ffmpegBin = resolveBinary("FFMPEG_PATH", ffmpegStatic as string | null, "ffmpeg");
  if (!ffmpegBin)
    throw new AppError("ffmpeg_missing", "FFmpeg was not found.", {
      status: 503,
      hint: "Reinstall Clippahh, or set FFMPEG_PATH to a valid ffmpeg executable.",
    });
  return ffmpegBin.path;
}

export function getFfprobe(): string {
  if (ffprobeBin === undefined) ffprobeBin = resolveBinary("FFPROBE_PATH", (ffprobeStatic as { path: string }).path, "ffprobe");
  if (!ffprobeBin)
    throw new AppError("ffprobe_missing", "FFprobe was not found.", {
      status: 503,
      hint: "Reinstall Clippahh, or set FFPROBE_PATH to a valid ffprobe executable.",
    });
  return ffprobeBin.path;
}

export interface RunOpts {
  signal?: AbortSignal;
  duration?: number;
  onProgress?: (timeSec: number) => void;
  onStdout?: (chunk: Buffer) => void;
  cwd?: string;
  timeoutMs?: number;
}

export function explainFfmpegError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("no space left")) return "Not enough disk space to finish this operation.";
  if (s.includes("moov atom not found") || s.includes("invalid data found") || s.includes("end of file"))
    return "The media file appears to be corrupted or incomplete.";
  if (s.includes("unknown decoder") || s.includes("decoder") && s.includes("not found")) return "This file uses a codec that FFmpeg cannot decode.";
  if (s.includes("permission denied")) return "Permission denied while reading or writing a file.";
  if (s.includes("no such file")) return "A required file was not found.";
  if (s.includes("cannot load nvcuda") || s.includes("nvenc") && s.includes("error")) return "GPU encoding failed (NVENC unavailable).";
  const lines = stderr.trim().split("\n").filter(Boolean);
  return lines.slice(-2).join(" ").slice(0, 300) || "FFmpeg failed.";
}

export function runFFmpeg(args: string[], opts: RunOpts = {}): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    let bin: string;
    try {
      bin = getFfmpeg();
    } catch (e) {
      return reject(e);
    }
    const child: ChildProcess = spawn(bin, ["-hide_banner", "-nostdin", ...args], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let tail = "";
    let finished = false;
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout?.on("data", (d: Buffer) => opts.onStdout?.(d));
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      tail = (tail + s).slice(-8000);
      stderr = tail;
      if (opts.onProgress) {
        const m = [...s.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
        if (m) opts.onProgress(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
      }
    });
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      reject(new AppError("ffmpeg_spawn", `Could not start FFmpeg: ${err.message}`, { status: 500 }));
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code === 0) return resolve({ stderr });
      reject(new AppError("ffmpeg_failed", explainFfmpegError(stderr), { status: 500, hint: stderr.slice(-600) }));
    });
  });
}

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string;
  bitrate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  sampleRate: number;
  raw: unknown;
}

function parseFps(s?: string): number {
  if (!s) return 0;
  const [a, b] = s.split("/").map(Number);
  if (!a) return 0;
  return b ? a / b : a;
}

export function probe(file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(file)) return reject(new AppError("file_missing", "The file does not exist.", { status: 404 }));
    let bin: string;
    try {
      bin = getFfprobe();
    } catch (e) {
      return reject(e);
    }
    const child = spawn(bin, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new AppError("ffprobe_spawn", `Could not start FFprobe: ${e.message}`, { status: 500 })));
    child.on("close", (code) => {
      if (code !== 0) {
        const known = explainFfmpegError(err);
        return reject(new AppError("unreadable_media", known && known.length < 120 ? known : "This file could not be read as media (unsupported or corrupted)."));
      }
      try {
        const j = JSON.parse(out) as {
          streams?: Array<Record<string, string | number>>;
          format?: Record<string, string>;
        };
        const streams = j.streams ?? [];
        const v = streams.find((s) => s.codec_type === "video" && !(s.disposition as unknown as { attached_pic?: number } | undefined)?.attached_pic);
        const a = streams.find((s) => s.codec_type === "audio");
        if (!v && !a) return reject(new AppError("no_streams", "No audio or video streams were found in this file."));
        const fmt = j.format ?? {};
        let duration = parseFloat(String(fmt.duration ?? "")) || parseFloat(String(v?.duration ?? a?.duration ?? "")) || 0;
        if (!Number.isFinite(duration)) duration = 0;
        resolve({
          duration,
          width: Number(v?.width ?? 0),
          height: Number(v?.height ?? 0),
          fps: parseFps(String(v?.avg_frame_rate ?? v?.r_frame_rate ?? "")),
          videoCodec: v ? String(v.codec_name) : null,
          audioCodec: a ? String(a.codec_name) : null,
          container: String(fmt.format_name ?? ""),
          bitrate: parseFloat(String(fmt.bit_rate ?? "0")) || 0,
          hasVideo: !!v,
          hasAudio: !!a,
          sampleRate: Number(a?.sample_rate ?? 0),
          raw: { format: fmt, streams: streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, profile: s.profile, pix_fmt: s.pix_fmt, channels: s.channels, lang: (s.tags as unknown as Record<string, string> | undefined)?.language })) },
        });
      } catch {
        reject(new AppError("probe_parse", "Could not parse media information."));
      }
    });
  });
}

/** Determine whether browsers can generally play this file natively. */
export function isBrowserPlayable(info: MediaInfo): boolean {
  const c = info.container;
  const mp4ish = c.includes("mp4") || c.includes("mov");
  const webm = c.includes("webm") || c.includes("matroska") && ["vp8", "vp9", "av1"].includes(info.videoCodec ?? "");
  if (!info.hasVideo) {
    return ["mp3", "aac", "flac", "vorbis", "opus", "pcm_s16le"].includes(info.audioCodec ?? "") && (c.includes("mp3") || c.includes("wav") || c.includes("flac") || c.includes("ogg") || mp4ish || c.includes("aac"));
  }
  if (!mp4ish && !webm) return false;
  if (!["h264", "vp8", "vp9", "av1"].includes(info.videoCodec ?? "")) return false;
  if (info.audioCodec && !["aac", "mp3", "opus", "vorbis", "flac"].includes(info.audioCodec)) return false;
  return true;
}

export interface HardwareInfo {
  ffmpeg: { path: string; source: string; version: string } | null;
  ffprobe: boolean;
  encoders: { h264: string[]; hevc: string[]; vp9: string[]; av1: string[] };
  nvenc: boolean;
  gpuName: string | null;
  cpuCores: number;
  memGB: number;
  platform: string;
}

let hwCache: { at: number; value: HardwareInfo } | null = null;

export async function detectHardware(force = false): Promise<HardwareInfo> {
  if (!force && hwCache && Date.now() - hwCache.at < 5 * 60_000) return hwCache.value;
  const info: HardwareInfo = {
    ffmpeg: null,
    ffprobe: false,
    encoders: { h264: [], hevc: [], vp9: [], av1: [] },
    nvenc: false,
    gpuName: null,
    cpuCores: os.cpus().length,
    memGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    platform: `${os.platform()} ${os.release()}`,
  };
  try {
    const bin = getFfmpeg();
    const ver = spawnSync(bin, ["-version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
    info.ffmpeg = { path: bin, source: ffmpegBin?.source ?? "unknown", version: ver.replace(/^ffmpeg version /, "").split(" ")[0] };
    const enc = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout;
    const has = (n: string) => new RegExp(`\\s${n}\\s`).test(enc);
    info.encoders.h264 = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf"].filter(has);
    info.encoders.hevc = ["libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf"].filter(has);
    info.encoders.vp9 = ["libvpx-vp9"].filter(has);
    info.encoders.av1 = ["libsvtav1", "libaom-av1", "av1_nvenc", "av1_qsv", "av1_amf"].filter(has);
    if (has("h264_nvenc")) {
      const t = spawnSync(bin, ["-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2", "-frames:v", "2", "-c:v", "h264_nvenc", "-f", "null", "-"], { timeout: 15000 });
      info.nvenc = t.status === 0;
    }
  } catch {
    /* ffmpeg missing; reported via info.ffmpeg === null */
  }
  try {
    info.ffprobe = !!getFfprobe();
  } catch {
    info.ffprobe = false;
  }
  const smi = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { encoding: "utf8", timeout: 5000 });
  if (smi.status === 0 && smi.stdout.trim()) info.gpuName = smi.stdout.trim().split("\n")[0];
  hwCache = { at: Date.now(), value: info };
  return info;
}

export function pickEncoder(codec: "h264" | "hevc" | "vp9" | "av1", hw: HardwareInfo, allowGpu: boolean): { name: string; gpu: boolean } {
  const list = hw.encoders[codec];
  if (allowGpu && hw.nvenc) {
    const n = list.find((x) => x.endsWith("_nvenc"));
    if (n) return { name: n, gpu: true };
  }
  const cpu = list.find((x) => x.startsWith("lib"));
  if (cpu) return { name: cpu, gpu: false };
  throw new AppError("encoder_missing", `No encoder is available for ${codec.toUpperCase()} in this FFmpeg build.`, {
    hint: "Choose H.264 or install a full FFmpeg build.",
  });
}

export async function freeDiskBytes(dir: string): Promise<number> {
  try {
    const s = await fs.promises.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function assertDisk(dir: string, neededBytes: number): Promise<void> {
  const free = await freeDiskBytes(dir);
  if (free < neededBytes) {
    throw new AppError("disk_space", `Insufficient disk space: ${(free / 1e9).toFixed(1)} GB free, about ${(neededBytes / 1e9).toFixed(1)} GB needed.`, {
      status: 507,
      hint: "Free up space or choose a different output folder in Settings.",
    });
  }
}
