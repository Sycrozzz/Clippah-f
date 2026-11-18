import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { importLocalPath } from "@/lib/server/media";
import { enqueueJob } from "@/lib/server/queue";
import { assertPublicUrl } from "@/lib/server/download";

export const dynamic = "force-dynamic";

/**
 * POST { projectId, path }  → import a local file or whole folder (referenced in place, not copied)
 * POST { projectId, url, rights } → queue a download job (direct media links, or platform links via yt-dlp)
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ projectId?: number; path?: string; url?: string; rights?: boolean }>(req);
    const projectId = Number(body.projectId);
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!p) throw new AppError("not_found", "Project not found", { status: 404 });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    if (body.path) {
      const r = await importLocalPath(projectId, body.path.trim().replace(/^"|"$/g, ""));
      return Response.json(r, { status: 201 });
    }
    if (body.url) {
      let u: URL;
      try {
        u = new URL(body.url.trim());
      } catch {
        throw new AppError("bad_url", "That is not a valid link.");
      }
      await assertPublicUrl(u);
      const job = await enqueueJob({ type: "download", projectId, config: { url: u.toString(), rights: !!body.rights } });
      return Response.json({ job }, { status: 202 });
    }
    throw new AppError("bad_request", "Provide a local path or a URL.");
  } catch (e) {
    return jsonError(e);
  }
}
