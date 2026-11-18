import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, media } from "@/db/schema";
import { jsonError, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { deleteMediaFiles } from "@/lib/server/media";
import { rmSafe } from "@/lib/server/paths";
import { cancelJob } from "@/lib/server/queue";
import { jobs } from "@/db/schema";
import { and, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [m] = await db.select().from(media).where(eq(media.id, id));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    const { filePath: _fp, proxyPath: _pp, thumbPath: _tp, chatPath: _cp, ...safe } = m;
    void _fp; void _pp; void _tp; void _cp;
    return Response.json({ media: { ...safe, hasProxy: !!m.proxyPath, hasThumb: !!m.thumbPath, sourcePath: m.sourceType === "path" ? m.filePath : undefined } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [m] = await db.select().from(media).where(eq(media.id, id));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    const active = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.mediaId, id), inArray(jobs.status, ["queued", "running"])));
    for (const j of active) await cancelJob(j.id);
    const cs = await db.select({ thumb: clips.thumbPath }).from(clips).where(eq(clips.mediaId, id));
    cs.forEach((c) => rmSafe(c.thumb));
    await deleteMediaFiles(m);
    await db.delete(media).where(eq(media.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
