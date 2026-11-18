import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET ?mediaId=1 — latest analysis (timeline, category, summary) for editor/timeline display. */
export async function GET(req: Request) {
  try {
    const mediaId = Number(new URL(req.url).searchParams.get("mediaId"));
    if (!mediaId) return Response.json({ analysis: null });
    const [a] = await db
      .select({ id: analyses.id, category: analyses.category, categoryConfidence: analyses.categoryConfidence, timeline: analyses.timeline, config: analyses.config, summary: analyses.summary, createdAt: analyses.createdAt })
      .from(analyses)
      .where(eq(analyses.mediaId, mediaId))
      .orderBy(desc(analyses.id))
      .limit(1);
    if (a) {
      const s = a.summary as Record<string, unknown>;
      delete s.silences;
      delete s.llmHighlights;
    }
    return Response.json({ analysis: a ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
