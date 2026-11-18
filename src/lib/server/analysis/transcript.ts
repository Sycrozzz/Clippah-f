import fs from "node:fs";
import path from "node:path";
import type { Cue } from "@/lib/shared/types";
import { runFFmpeg } from "../ffmpeg";
import { getTranscriber, AIError } from "../ai/providers";
import { AppError, CancelledError } from "../errors";

const CHUNK_SEC = 600;

/**
 * Extract audio in chunks (small files for API upload limits) and transcribe each,
 * offsetting timestamps back to media time. Streams chunks from disk — never whole video in RAM.
 */
export async function transcribeMedia(opts: {
  file: string;
  duration: number;
  tmpDir: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (f: number, msg?: string) => void;
}): Promise<{ segments: Cue[]; language?: string; provider: string }> {
  const { transcriber, reason } = await getTranscriber();
  if (!transcriber) throw new AIError("not_configured", reason ?? "Speech recognition is not configured.");
  const ext = transcriber.chunkFormat;
  const codecArgs = ext === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "48k"] : ["-c:a", "pcm_s16le"];
  await runFFmpeg(
    ["-y", "-i", opts.file, "-vn", "-ac", "1", "-ar", "16000", ...codecArgs, "-f", "segment", "-segment_time", String(CHUNK_SEC), "-reset_timestamps", "1", path.join(opts.tmpDir, `chunk%04d.${ext}`)],
    { signal: opts.signal },
  );
  const chunks = fs
    .readdirSync(opts.tmpDir)
    .filter((f) => f.startsWith("chunk") && f.endsWith(`.${ext}`))
    .sort();
  if (!chunks.length) throw new AppError("no_audio", "No audio could be extracted for transcription.");
  const all: Cue[] = [];
  let language: string | undefined;
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw new CancelledError();
    opts.onProgress?.(i / chunks.length, `Transcribing part ${i + 1} of ${chunks.length}`);
    const chunkDur = Math.min(CHUNK_SEC, opts.duration - i * CHUNK_SEC);
    const r = await transcriber.transcribe(path.join(opts.tmpDir, chunks[i]), { language: opts.language || undefined, signal: opts.signal, chunkDuration: chunkDur });
    language ??= r.language;
    for (const s of r.segments) all.push({ start: s.start + i * CHUNK_SEC, end: s.end + i * CHUNK_SEC, text: s.text });
    fs.rmSync(path.join(opts.tmpDir, chunks[i]), { force: true });
  }
  opts.onProgress?.(1);
  return { segments: all, language, provider: transcriber.id };
}
