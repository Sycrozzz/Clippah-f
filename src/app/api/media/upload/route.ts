import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { jsonError } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { newUploadPath, registerMedia } from "@/lib/server/media";
import { assertDisk } from "@/lib/server/ffmpeg";
import { dirs, rmSafe } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

/**
 * Streams the raw request body to disk (never buffers the video in RAM).
 * POST /api/media/upload?projectId=1&name=video.mp4[&recording=1]
 */
export async function POST(req: Request) {
  let filePath: string | null = null;
  try {
    const url = new URL(req.url);
    const projectId = Number(url.searchParams.get("projectId"));
    const name = url.searchParams.get("name") ?? "";
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError("bad_project", "A valid project is required.");
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!p) throw new AppError("not_found", "Project not found", { status: 404 });
    if (!req.body) throw new AppError("empty_body", "No file data was received.");
    const alloc = newUploadPath(name); // validates the extension
    filePath = alloc.filePath;
    const len = Number(req.headers.get("content-length") ?? 0);
    await assertDisk(dirs.media, Math.max(len * 1.15, 50e6));
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(filePath));
    const row = await registerMedia({
      projectId,
      filePath,
      originalName: name,
      ownsFile: true,
      sourceType: url.searchParams.get("recording") ? "recording" : "upload",
    });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    return Response.json({ media: row }, { status: 201 });
  } catch (e) {
    rmSafe(filePath);
    return jsonError(e);
  }
}
