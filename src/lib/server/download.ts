import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError, CancelledError } from "./errors";
import { dirs, ensureDirs, sanitizeFilename } from "./paths";
import { MEDIA_EXT, registerMedia, newUploadPath } from "./media";
import type { JobContext } from "./queue";
import { getSettings } from "./settings";
import { assertDisk } from "./ffmpeg";

const PLATFORM_HOSTS = ["youtube.com", "youtu.be", "twitch.tv", "kick.com", "tiktok.com", "instagram.com"];
const MAX_BYTES = 20 * 1024 ** 3;

export function platformOf(url: URL): string | null {
  const h = url.hostname.toLowerCase();
  return PLATFORM_HOSTS.find((p) => h === p || h.endsWith(`.${p}`)) ?? null;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
}

/** SSRF protection: refuse URLs that resolve to private / loopback addresses. */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (!["http:", "https:"].includes(u.protocol)) throw new AppError("bad_url", "Only http(s) links are supported.");
  if (net.isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new AppError("private_url", "Links to private network addresses are blocked.", { status: 403 });
    return;
  }
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => {
    throw new AppError("dns_failed", `Could not resolve ${u.hostname}. Check the link and your connection.`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new AppError("private_url", "Links to private network addresses are blocked.", { status: 403 });
}

export function findYtDlp(configured: string): string | null {
  const candidates = [configured, process.env.YT_DLP_PATH ?? "", "yt-dlp"].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return c;
  }
  return null;
}

async function downloadDirect(ctx: JobContext, url: URL): Promise<{ filePath: string; name: string }> {
  let current = url;
  let res: Response | null = null;
  for (let i = 0; i < 5; i++) {
    await assertPublicUrl(current);
    res = await fetch(current, { redirect: "manual", signal: ctx.signal, headers: { "User-Agent": "Clippahh/1.0" } }).catch((e) => {
      if (ctx.signal.aborted) throw new CancelledError();
      throw new AppError("network", `Network error while contacting ${current.hostname}: ${e instanceof Error ? e.message : e}`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new AppError("download_failed", `The server responded with ${res?.status ?? "no response"}.`);
  const nameFromUrl = decodeURIComponent(path.basename(current.pathname)) || "download";
  let name = nameFromUrl;
  const ct = res.headers.get("content-type") ?? "";
  if (!MEDIA_EXT.includes(path.extname(name).toLowerCase())) {
    const map: Record<string, string> = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a" };
    const ext = map[ct.split(";")[0].trim()];
    if (!ext) throw new AppError("not_media", "That link does not point to a supported media file.", { hint: "Use a direct link to a video/audio file, or download the video you own and import it as a file." });
    name += ext;
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total > MAX_BYTES) throw new AppError("too_large", "The file is larger than the 20 GB download limit.");
  if (total) await assertDisk(dirs.media, total * 1.1);
  const { filePath } = newUploadPath(sanitizeFilename(name, "download.mp4"));
  let got = 0;
  const src = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  src.on("data", (c: Buffer) => {
    got += c.length;
    if (got > MAX_BYTES) src.destroy(new AppError("too_large", "Download exceeded the size limit."));
    if (total) ctx.update({ progress: got / total });
  });
  try {
    await pipeline(src, fs.createWriteStream(filePath), { signal: ctx.signal });
  } catch (e) {
    fs.rmSync(filePath, { force: true });
    if (ctx.signal.aborted) throw new CancelledError();
    throw e;
  }
  return { filePath, name };
}

async function downloadPlatform(ctx: JobContext, url: URL, platform: string): Promise<{ filePath: string; name: string }> {
  const settings = await getSettings();
  const bin = findYtDlp(settings.sources.ytDlpPath);
  if (!bin)
    throw new AppError("ytdlp_missing", `Importing ${platform} links requires the optional yt-dlp tool, which was not found.`, {
      hint: "Install yt-dlp and set its path in Settings → Sources, or download your own video through the platform's official export and import the file.",
      status: 422,
    });
  ensureDirs();
  const stem = `dl-${Date.now()}`;
  const template = path.join(dirs.media, `${stem}.%(ext)s`);
  const args = ["--no-playlist", "--no-warnings", "--newline", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", template, url.toString()];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    ctx.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    child.stdout.on("data", (d: Buffer) => {
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(d.toString());
      if (m) ctx.update({ progress: parseFloat(m[1]) / 100 });
    });
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-1500)));
    child.on("error", (e) => reject(new AppError("ytdlp_spawn", `Could not start yt-dlp: ${e.message}`)));
    child.on("close", (code) => {
      if (ctx.signal.aborted) return reject(new CancelledError());
      if (code === 0) return resolve();
      reject(new AppError("download_failed", `The platform download failed. ${err.split("\n").filter(Boolean).pop() ?? ""}`.trim(), { hint: "The video may be private, geo-blocked, age-restricted, or require login." }));
    });
  });
  const file = fs.readdirSync(dirs.media).find((f) => f.startsWith(stem + "."));
  if (!file) throw new AppError("download_failed", "The download finished but no file was produced.");
  return { filePath: path.join(dirs.media, file), name: file };
}

export async function runDownloadJob(ctx: JobContext): Promise<void> {
  const cfg = ctx.job.config as { url: string; rights?: boolean };
  const url = new URL(cfg.url);
  const platform = platformOf(url);
  ctx.update({ stage: "Downloading", message: url.hostname });
  if (platform && !cfg.rights)
    throw new AppError("rights_required", "Confirm that you own this content or have permission to download it.");
  const { filePath, name } = platform ? await downloadPlatform(ctx, url, platform) : await downloadDirect(ctx, url);
  ctx.update({ stage: "Reading media", progress: 0.98 });
  const row = await registerMedia({ projectId: ctx.job.projectId!, filePath, originalName: name, ownsFile: true, sourceType: "url", sourceUrl: url.toString() });
  ctx.setResult({ mediaId: row.id });
  ctx.log("info", `Imported “${row.originalName}”`);
}
