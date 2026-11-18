import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, exportsTable, jobs, projects } from "@/db/schema";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { queueExports } from "@/lib/server/export";
import { getSettings } from "@/lib/server/settings";
import { applyPreset } from "@/lib/shared/presets";
import type { ExportSettings } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const pid = new URL(req.url).searchParams.get("projectId");
    const q = db
      .select({
        id: exportsTable.id,
        clipId: exportsTable.clipId,
        projectId: exportsTable.projectId,
        projectName: projects.name,
        title: exportsTable.title,
        settings: exportsTable.settings,
        filePath: exportsTable.filePath,
        hasSrt: exportsTable.srtPath,
        sizeBytes: exportsTable.sizeBytes,
        durationSec: exportsTable.durationSec,
        status: exportsTable.status,
        error: exportsTable.error,
        createdAt: exportsTable.createdAt,
        jobId: exportsTable.jobId,
        jobStatus: jobs.status,
        jobStage: jobs.stage,
        progress: jobs.progress,
        etaSeconds: jobs.etaSeconds,
        jobError: jobs.error,
      })
      .from(exportsTable)
      .innerJoin(projects, eq(exportsTable.projectId, projects.id))
      .leftJoin(jobs, eq(exportsTable.jobId, jobs.id));
    const rows = await (pid ? q.where(eq(exportsTable.projectId, Number(pid))) : q).orderBy(desc(exportsTable.id)).limit(200);
    return Response.json({ exports: rows.map((r) => ({ ...r, hasSrt: !!r.hasSrt })) });
  } catch (e) {
    return jsonError(e);
  }
}

/** POST { clipIds?: number[], projectId?: number (all approved), settings?: Partial<ExportSettings> } */
export async function POST(req: Request) {
  try {
    const b = await readJson<{ clipIds?: number[]; projectId?: number; settings?: Partial<ExportSettings> }>(req);
    let ids = (b.clipIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length && b.projectId) {
      const all = await db.select({ id: clips.id, status: clips.status }).from(clips).where(eq(clips.projectId, Number(b.projectId)));
      ids = all.filter((c) => c.status === "approved").map((c) => c.id);
    }
    if (!ids.length) throw new AppError("no_clips", "No clips selected. Approve clips first, or pick clips to export.");
    const app = await getSettings();
    const merged: ExportSettings = { ...applyPreset(app.export, b.settings?.preset ?? app.export.preset), ...(b.settings ?? {}) };
    const created = await queueExports(ids, merged);
    return Response.json({ exportIds: created }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
