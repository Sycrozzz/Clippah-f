import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { AppError } from "./errors";
import { assertDisk, isBrowserPlayable, probe, runFFmpeg } from "./ffmpeg";
import { dirs, ensureDirs, isInside, rmSafe, sanitizeFilename } from "./paths";
import { enqueueJob, type JobContext } from "./queue";
import { getSettings } from "./settings";

export const VIDEO_EXT = [".mp4", ".m4v", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".flv"];
export const AUDIO_EXT = [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"];
export const MEDIA_EXT = [...VIDEO_EXT, ...AUDIO_EXT];

export type MediaRow = typeof media.$inferSelect;

export function assertSupportedExtension(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_EXT.includes(ext)) {
    throw new AppError("unsupported_format", `“${ext || "no extension"}” is not a supported format.`, {
      hint: `Supported: ${MEDIA_EXT.map((e) => e.slice(1).toUpperCase()).join(", ")}`,
    });
  }
  return ext;
}

export async function makeThumb(file: string, time: number, out: string, width = 480): Promise<boolean> {
  try {
    await runFFmpeg(["-y", "-ss", String(Math.max(0, time)), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out], { timeoutMs: 60_000 });
    return fs.existsSync(out);
  } catch {
    return false;
  }
}

/** Allocate a destination path in the managed media directory for an upload. */
export function newUploadPath(originalName: string): { filePath: string; ext: string } {
  ensureDirs();
  const ext = assertSupportedExtension(originalName);
  const base = sanitizeFilename(path.basename(originalName, path.extname(originalName)), "media").slice(0, 80);
  const filePath = path.join(dirs.media, `${crypto.randomBytes(4).toString("hex")}-${base}${ext}`);
  return { filePath, ext };
}

export async function registerMedia(input: {
  projectId: number;
  filePath: string;
  originalName: string;
  ownsFile: boolean;
  sourceType: "upload" | "path" | "url" | "recording";
  sourceUrl?: string;
}): Promise<MediaRow> {
  const { filePath } = input;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) throw new AppError("empty_file", "The file is empty or not a regular file.");
    let info = await probe(filePath);
    // Browser recordings (MediaRecorder WebM) often lack duration metadata: remux to fix.
    if ((!info.duration || info.duration <= 0) && input.ownsFile) {
      const fixed = filePath.replace(/(\.[^.]+)$/, ".fixed$1");
      await runFFmpeg(["-y", "-i", filePath, "-c", "copy", fixed]);
      fs.renameSync(fixed, filePath);
      info = await probe(filePath);
    }
    if (!info.duration || info.duration <= 0) throw new AppError("no_duration", "The media has no readable duration (file may be corrupted).");
    const playable = isBrowserPlayable(info);
    const [row] = await db
      .insert(media)
      .values({
        projectId: input.projectId,
        originalName: input.originalName,
        filePath,
        ownsFile: input.ownsFile,
        sizeBytes: fs.statSync(filePath).size,
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        container: info.container,
        bitrate: info.bitrate,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
        browserPlayable: playable,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
      })
      .returning();
    if (info.hasVideo) {
      ensureDirs();
      const out = path.join(dirs.thumbs, `media-${row.id}.jpg`);
      if (await makeThumb(filePath, Math.min(info.duration * 0.1, 30), out)) {
        await db.update(media).set({ thumbPath: out }).where(eq(media.id, row.id));
        row.thumbPath = out;
      }
    }
    if (!playable && info.hasVideo && (await getSettings()).processing.autoProxy) {
      await enqueueJob({ type: "proxy", projectId: input.projectId, mediaId: row.id });
    }
    return row;
  } catch (e) {
    if (input.ownsFile) rmSafe(filePath);
    throw e;
  }
}

export async function importLocalPath(projectId: number, target: string): Promise<{ imported: MediaRow[]; failed: { file: string; error: string }[] }> {
  if (!path.isAbsolute(target)) throw new AppError("bad_path", "Please provide an absolute path (e.g. C:\\Videos\\stream.mp4).");
  const roots = (process.env.CLIPPAHH_IMPORT_ROOTS ?? "").split(path.delimiter).filter(Boolean);
  const resolved = path.resolve(target);
  if (roots.length && !roots.some((r) => resolved === path.resolve(r) || isInside(r, resolved)))
    throw new AppError("path_forbidden", "This location is outside the allowed import folders (CLIPPAHH_IMPORT_ROOTS).", { status: 403 });
  if (!fs.existsSync(resolved)) throw new AppError("path_missing", "That path does not exist.", { status: 404 });
  const files: string[] = [];
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (files.length >= 2000) return;
        const p = path.join(d, e.name);
        if (e.isDirectory() && !e.name.startsWith(".")) walk(p);
        else if (e.isFile() && MEDIA_EXT.includes(path.extname(e.name).toLowerCase())) files.push(p);
      }
    };
    walk(resolved);
    if (!files.length) throw new AppError("empty_folder", "No supported media files were found in that folder.");
  } else {
    assertSupportedExtension(resolved);
    files.push(resolved);
  }
  const imported: MediaRow[] = [];
  const failed: { file: string; error: string }[] = [];
  for (const f of files) {
    try {
      imported.push(await registerMedia({ projectId, filePath: f, originalName: path.basename(f), ownsFile: false, sourceType: "path" }));
    } catch (e) {
      failed.push({ file: f, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { imported, failed };
}

export async function deleteMediaFiles(m: MediaRow): Promise<void> {
  if (m.ownsFile) rmSafe(m.filePath);
  rmSafe(m.proxyPath);
  rmSafe(m.thumbPath);
  rmSafe(m.chatPath);
}

export async function runProxyJob(ctx: JobContext): Promise<void> {
  const mediaId = ctx.job.mediaId!;
  const [m] = await db.select().from(media).where(eq(media.id, mediaId));
  if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
  ensureDirs();
  await assertDisk(dirs.proxies, Math.max(m.duration * 400_000, 50e6));
  const out = path.join(dirs.proxies, `proxy-${m.id}.mp4`);
  ctx.update({ stage: "Creating preview proxy", message: "Transcoding to a browser-friendly preview (720p H.264)" });
  await runFFmpeg(
    ["-y", "-i", m.filePath, "-vf", "scale=-2:'min(720,ih)',format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out],
    { signal: ctx.signal, duration: m.duration, onProgress: (t) => ctx.update({ progress: t / m.duration }) },
  ).catch((e) => {
    rmSafe(out);
    throw e;
  });
  await db.update(media).set({ proxyPath: out }).where(eq(media.id, m.id));
}
