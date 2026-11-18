import { eq } from "drizzle-orm";
import path from "node:path";
import { db } from "@/db";
import { exportsTable } from "@/db/schema";
import { jsonError, serveFile, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { cancelJob } from "@/lib/server/queue";
import { rmSafe } from "@/lib/server/paths";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET ?srt=1 downloads the subtitle file; otherwise the video. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [e] = await db.select().from(exportsTable).where(eq(exportsTable.id, id));
    if (!e) throw new AppError("not_found", "Export not found", { status: 404 });
    const wantSrt = new URL(req.url).searchParams.get("srt") === "1";
    const file = wantSrt ? e.srtPath : e.filePath;
    if (!file || e.status !== "completed") throw new AppError("not_ready", "This export file is not available.", { status: 404 });
    return serveFile(req, file, { download: path.basename(file) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [e] = await db.select().from(exportsTable).where(eq(exportsTable.id, id));
    if (e) {
      if (e.jobId && (e.status === "queued" || e.status === "running")) await cancelJob(e.jobId);
      if (new URL(req.url).searchParams.get("deleteFile") === "1") {
        rmSafe(e.filePath);
        rmSafe(e.srtPath);
      }
      await db.delete(exportsTable).where(eq(exportsTable.id, id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
