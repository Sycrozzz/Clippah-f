import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips } from "@/db/schema";
import { serveFile, toId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const [c] = await db.select({ t: clips.thumbPath }).from(clips).where(eq(clips.id, id));
    if (!c?.t) return new Response(null, { status: 404 });
    return serveFile(req, c.t);
  } catch {
    return new Response(null, { status: 404 });
  }
}
