import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, media, projects } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { deleteMediaFiles } from "@/lib/server/media";
import { rmSafe } from "@/lib/server/paths";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    if (!p) throw new AppError("not_found", "Project not found", { status: 404 });
    return Response.json({ project: p });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const body = await readJson<{ name?: string; description?: string }>(req);
    const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new AppError("bad_name", "Project name is required.");
      set.name = body.name.trim().slice(0, 120);
    }
    if (body.description !== undefined) set.description = body.description.slice(0, 500);
    const [p] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
    if (!p) throw new AppError("not_found", "Project not found", { status: 404 });
    return Response.json({ project: p });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const ms = await db.select().from(media).where(eq(media.projectId, id));
    const cs = await db.select({ thumb: clips.thumbPath }).from(clips).where(eq(clips.projectId, id));
    for (const m of ms) await deleteMediaFiles(m);
    for (const c of cs) rmSafe(c.thumb);
    await db.delete(projects).where(eq(projects.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
