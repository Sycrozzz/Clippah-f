import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { serveFile, toId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const [m] = await db.select({ t: media.thumbPath }).from(media).where(eq(media.id, id));
    if (!m?.t) return new Response(null, { status: 404 });
    return serveFile(req, m.t);
  } catch {
    return new Response(null, { status: 404 });
  }
}
