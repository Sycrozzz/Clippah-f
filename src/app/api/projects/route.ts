import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        mediaCount: sql<number>`(select count(*)::int from media where media.project_id = projects.id)`,
        clipCount: sql<number>`(select count(*)::int from clips where clips.project_id = projects.id)`,
        approvedCount: sql<number>`(select count(*)::int from clips where clips.project_id = projects.id and clips.status = 'approved')`,
        exportCount: sql<number>`(select count(*)::int from exports where exports.project_id = projects.id and exports.status = 'completed')`,
        thumbMediaId: sql<number | null>`(select id from media where media.project_id = projects.id and thumb_path is not null order by id desc limit 1)`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    return Response.json({ projects: rows });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const { name, description } = await readJson<{ name?: string; description?: string }>(req);
    const n = (name ?? "").trim();
    if (!n) throw new AppError("bad_name", "Project name is required.");
    const [row] = await db.insert(projects).values({ name: n.slice(0, 120), description: (description ?? "").slice(0, 500) }).returning();
    return Response.json({ project: row }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
