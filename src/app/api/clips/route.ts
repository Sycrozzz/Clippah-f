import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clips, media, transcripts } from "@/db/schema";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { cuesInRange, refreshClipThumb } from "@/lib/server/clips";
import { getSettings } from "@/lib/server/settings";
import { DEFAULT_AUDIO, DEFAULT_CROP } from "@/lib/shared/defaults";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const conds = [];
    if (sp.get("projectId")) conds.push(eq(clips.projectId, Number(sp.get("projectId"))));
    if (sp.get("mediaId")) conds.push(eq(clips.mediaId, Number(sp.get("mediaId"))));
    if (sp.get("status")) conds.push(eq(clips.status, sp.get("status")!));
    const sort = sp.get("sort");
    const order = sort === "time" ? [asc(clips.mediaId), asc(clips.startSec)] : sort === "recent" ? [desc(clips.updatedAt)] : [desc(clips.score), asc(clips.rank)];
    const limit = Math.min(500, Number(sp.get("limit") ?? 200));
    const rows = await db
      .select({
        id: clips.id,
        projectId: clips.projectId,
        mediaId: clips.mediaId,
        mediaName: media.originalName,
        title: clips.title,
        startSec: clips.startSec,
        endSec: clips.endSec,
        score: clips.score,
        confidence: clips.confidence,
        category: clips.category,
        reason: clips.reason,
        evidence: clips.evidence,
        scores: clips.scores,
        status: clips.status,
        rank: clips.rank,
        source: clips.source,
        aspect: clips.aspect,
        hasThumb: sql<boolean>`${clips.thumbPath} is not null`,
        updatedAt: clips.updatedAt,
      })
      .from(clips)
      .innerJoin(media, eq(clips.mediaId, media.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(limit);
    return Response.json({ clips: rows });
  } catch (e) {
    return jsonError(e);
  }
}

/** Manual clip creation: { mediaId, startSec, endSec, title? } */
export async function POST(req: Request) {
  try {
    const b = await readJson<{ mediaId?: number; startSec?: number; endSec?: number; title?: string }>(req);
    const [m] = await db.select().from(media).where(eq(media.id, Number(b.mediaId)));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    const start = Number(b.startSec);
    const end = Number(b.endSec);
    if (!(start >= 0) || !(end > start + 0.9) || end > m.duration + 0.5) throw new AppError("bad_range", "Choose a valid start and end time within the media.");
    const [t] = await db.select().from(transcripts).where(eq(transcripts.mediaId, m.id));
    const cues = cuesInRange(t?.segments ?? [], start, end);
    const settings = await getSettings();
    const [row] = await db
      .insert(clips)
      .values({
        projectId: m.projectId,
        mediaId: m.id,
        title: (b.title ?? "").trim().slice(0, 120) || `Manual clip`,
        startSec: start,
        endSec: Math.min(end, m.duration),
        peakSec: (start + end) / 2,
        source: "manual",
        reason: "Created manually.",
        aspect: "9:16",
        crop: DEFAULT_CROP,
        audio: DEFAULT_AUDIO,
        subtitles: { enabled: cues.length > 0, cues, style: settings.subtitles },
      })
      .returning();
    void refreshClipThumb(row.id);
    return Response.json({ clip: row }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
