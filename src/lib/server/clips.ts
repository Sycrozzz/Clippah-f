import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, clips, media, transcripts } from "@/db/schema";
import type { Cue, SignalFamily } from "@/lib/shared/types";
import { dirs, ensureDirs } from "./paths";
import { makeThumb } from "./media";
import type { ScoringInput } from "./analysis/scoring";
import type { LLMHighlight } from "./analysis/semantic";
import { speechDensity } from "./analysis/text";

export type ClipRow = typeof clips.$inferSelect;

export function cuesInRange(segs: Cue[], start: number, end: number): Cue[] {
  return segs
    .filter((s) => s.end > start + 0.1 && s.start < end - 0.1)
    .map((s) => ({ start: Math.max(s.start, start), end: Math.min(s.end, end), text: s.text }));
}

export async function refreshClipThumb(clipId: number): Promise<void> {
  const [c] = await db.select().from(clips).where(eq(clips.id, clipId));
  if (!c) return;
  const [m] = await db.select().from(media).where(eq(media.id, c.mediaId));
  if (!m || !m.hasVideo) return;
  ensureDirs();
  const out = path.join(dirs.thumbs, `clip-${c.id}.jpg`);
  const t = c.peakSec && c.peakSec >= c.startSec && c.peakSec <= c.endSec ? c.peakSec : c.startSec + (c.endSec - c.startSec) / 2;
  if (await makeThumb(m.filePath, t, out, 480)) await db.update(clips).set({ thumbPath: out }).where(eq(clips.id, c.id));
}

/** Rebuild scoring inputs from the latest stored analysis (used by clip regeneration). */
export async function scoringInputFor(mediaId: number): Promise<{ input: ScoringInput; analysisId: number } | null> {
  const [a] = await db.select().from(analyses).where(eq(analyses.mediaId, mediaId)).orderBy(desc(analyses.id)).limit(1);
  if (!a) return null;
  const [m] = await db.select().from(media).where(eq(media.id, mediaId));
  const [t] = await db.select().from(transcripts).where(eq(transcripts.mediaId, mediaId));
  const segments = t?.segments ?? [];
  const summary = a.summary as { silences?: number[]; llmHighlights?: LLMHighlight[]; available?: Record<SignalFamily, boolean> };
  const available = summary.available ?? { audio: true, visual: false, semantic: segments.length > 0, chat: false, game: false, keyword: false };
  return {
    analysisId: a.id,
    input: {
      duration: m?.duration ?? a.timeline.duration,
      signals: a.signals,
      segments,
      silences: summary.silences ?? [],
      speech: segments.length ? speechDensity(segments, m?.duration ?? 0) : a.timeline.speech,
      available,
      category: a.category,
      config: a.config,
      llmHighlights: summary.llmHighlights ?? [],
    },
  };
}
