import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, media, projects } from "@/db/schema";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { enqueueJob, ensureQueue } from "@/lib/server/queue";
import { getSettings } from "@/lib/server/settings";
import { buildAnalysisConfig } from "@/lib/server/analysis/pipeline";
import type { AnalysisConfig } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureQueue();
    const sp = new URL(req.url).searchParams;
    const conds = [];
    if (sp.get("active") === "1") conds.push(inArray(jobs.status, ["queued", "running"]));
    if (sp.get("type")) conds.push(eq(jobs.type, sp.get("type")!));
    if (sp.get("projectId")) conds.push(eq(jobs.projectId, Number(sp.get("projectId"))));
    if (sp.get("mediaId")) conds.push(eq(jobs.mediaId, Number(sp.get("mediaId"))));
    const limit = Math.min(200, Number(sp.get("limit") ?? 60));
    const rows = await db
      .select({
        id: jobs.id,
        type: jobs.type,
        projectId: jobs.projectId,
        projectName: projects.name,
        mediaId: jobs.mediaId,
        mediaName: media.originalName,
        clipId: jobs.clipId,
        status: jobs.status,
        stage: jobs.stage,
        progress: jobs.progress,
        message: jobs.message,
        error: jobs.error,
        etaSeconds: jobs.etaSeconds,
        result: jobs.result,
        logs: jobs.logs,
        createdAt: jobs.createdAt,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .leftJoin(projects, eq(jobs.projectId, projects.id))
      .leftJoin(media, eq(jobs.mediaId, media.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobs.id))
      .limit(limit);
    return Response.json({ jobs: rows });
  } catch (e) {
    return jsonError(e);
  }
}

/** POST { type: "analysis", mediaId, config? } */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ type?: string; mediaId?: number; config?: Partial<AnalysisConfig> }>(req);
    if (body.type !== "analysis") throw new AppError("bad_type", "Unsupported job type.");
    const [m] = await db.select().from(media).where(eq(media.id, Number(body.mediaId)));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    const [dup] = await db.select().from(jobs).where(and(eq(jobs.mediaId, m.id), eq(jobs.type, "analysis"), inArray(jobs.status, ["queued", "running"])));
    if (dup) return Response.json({ job: dup, duplicate: true });
    const config = buildAnalysisConfig(await getSettings(), body.config ?? {});
    const job = await enqueueJob({ type: "analysis", projectId: m.projectId, mediaId: m.id, config: config as unknown as Record<string, unknown> });
    return Response.json({ job }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
