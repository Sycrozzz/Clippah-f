import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips } from "@/db/schema";
import { jsonError, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { clipRelativeCues } from "@/lib/server/export";
import { formatSrt } from "@/lib/shared/time";
import { sanitizeFilename } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const [c] = await db.select().from(clips).where(eq(clips.id, id));
    if (!c) throw new AppError("not_found", "Clip not found", { status: 404 });
    const cues = clipRelativeCues(c);
    if (!cues.length) throw new AppError("no_subtitles", "This clip has no subtitle cues.", { status: 404 });
    return new Response(formatSrt(cues), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(c.title, "clip") + ".srt")}`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
