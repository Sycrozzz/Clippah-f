import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { cancelJob, retryJob } from "@/lib/server/queue";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const [j] = await db.select().from(jobs).where(eq(jobs.id, toId((await params).id)));
    if (!j) throw new AppError("not_found", "Job not found", { status: 404 });
    return Response.json({ job: j });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    await cancelJob(toId((await params).id));
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const { action } = await readJson<{ action?: string }>(req);
    if (action !== "retry") throw new AppError("bad_action", "Unsupported action.");
    await retryJob(id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
