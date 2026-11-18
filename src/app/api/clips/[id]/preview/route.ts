import { jsonError, serveFile, toId } from "@/lib/server/http";
import { renderClipPreview } from "@/lib/server/export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Renders (and caches) a low-res preview with crop, subtitles and audio settings applied. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = toId((await params).id);
    const file = await renderClipPreview(id);
    return serveFile(req, file, { contentType: "video/mp4" });
  } catch (e) {
    return jsonError(e);
  }
}
