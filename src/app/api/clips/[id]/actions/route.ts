import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, transcripts } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { cuesInRange, refreshClipThumb, scoringInputFor } from "@/lib/server/clips";
import { regenerateBoundaries } from "@/lib/server/analysis/scoring";

export const dynamic = "force-dynamic";

/** POST { action: "duplicate" | "regenerate" | "resubtitle", mode?: "resnap"|"longer"|"shorter" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const { action, mode } = await readJson<{ action?: string; mode?: "resnap" | "longer" | "shorter" }>(req);
    const [c] = await db.select().from(clips).where(eq(clips.id, id));
    if (!c) throw new AppError("not_found", "Clip not found", { status: 404 });

    if (action === "duplicate") {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = c;
      void _id; void _c; void _u;
      const [top] = await db.select({ rank: clips.rank }).from(clips).where(eq(clips.mediaId, c.mediaId)).orderBy(desc(clips.rank)).limit(1);
      const [row] = await db
        .insert(clips)
        .values({ ...rest, title: `${c.title} (copy)`.slice(0, 120), status: "pending", source: "duplicate", rank: (top?.rank ?? 0) + 1 })
        .returning();
      void refreshClipThumb(row.id);
      return Response.json({ clip: row }, { status: 201 });
    }

    if (action === "regenerate") {
      const si = await scoringInputFor(c.mediaId);
      if (!si) throw new AppError("no_analysis", "Run AI analysis on this media first so boundaries can be regenerated.");
      const b = regenerateBoundaries(si.input, { start: c.startSec, end: c.endSec, peak: c.peakSec }, mode ?? "resnap");
      const cues = cuesInRange(si.input.segments, b.start, b.end);
      const [row] = await db
        .update(clips)
        .set({ startSec: b.start, endSec: b.end, subtitles: { ...c.subtitles, cues: cues.length ? cues : c.subtitles.cues }, updatedAt: new Date() })
        .where(eq(clips.id, id))
        .returning();
      void refreshClipThumb(id);
      return Response.json({ clip: row });
    }

    if (action === "resubtitle") {
      const [t] = await db.select().from(transcripts).where(eq(transcripts.mediaId, c.mediaId));
      if (!t) throw new AppError("no_transcript", "No transcript exists for this media. Run analysis with speech recognition or import an SRT file.");
      const cues = cuesInRange(t.segments, c.startSec, c.endSec);
      const [row] = await db.update(clips).set({ subtitles: { ...c.subtitles, cues, enabled: cues.length > 0 }, updatedAt: new Date() }).where(eq(clips.id, id)).returning();
      return Response.json({ clip: row });
    }
    throw new AppError("bad_action", "Unsupported action.");
  } catch (e) {
    return jsonError(e);
  }
}
