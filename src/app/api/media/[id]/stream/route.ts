import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { jsonError, serveFile, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const [m] = await db.select().from(media).where(eq(media.id, id));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    const useOriginal = new URL(req.url).searchParams.get("original") === "1";
    if (m.proxyPath && fs.existsSync(m.proxyPath) && !useOriginal && !m.browserPlayable) return serveFile(req, m.proxyPath);
    if (!m.browserPlayable && !useOriginal) throw new AppError("proxy_pending", "The preview proxy is still being prepared.", { status: 409 });
    return serveFile(req, m.filePath);
  } catch (e) {
    return jsonError(e);
  }
}
