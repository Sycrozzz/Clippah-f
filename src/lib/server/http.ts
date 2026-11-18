import fs from "node:fs";
import { Readable } from "node:stream";
import { AppError, describeError } from "./errors";

export function jsonError(e: unknown): Response {
  const d = describeError(e);
  if (d.status >= 500) console.error("[api]", d.message);
  return Response.json({ error: d.message, code: d.code, hint: d.hint }, { status: d.status });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function toId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("bad_id", "Invalid id", { status: 400 });
  return n;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".srt": "text/plain; charset=utf-8",
};

export function mimeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** Serve a file with HTTP Range support (needed for seeking in <video>). */
export function serveFile(req: Request, file: string, opts: { download?: string; contentType?: string } = {}): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return Response.json({ error: "File not found on disk", code: "file_missing" }, { status: 404 });
  }
  const size = stat.size;
  const type = opts.contentType ?? mimeFor(file);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  if (opts.download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : NaN;
      let end = m[2] ? parseInt(m[2], 10) : NaN;
      if (Number.isNaN(start)) {
        start = Math.max(0, size - (end || 0));
        end = size - 1;
      } else if (Number.isNaN(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
  }
  const stream = fs.createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
