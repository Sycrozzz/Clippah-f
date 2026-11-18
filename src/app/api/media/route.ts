import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const pid = new URL(req.url).searchParams.get("projectId");
    const q = db
      .select({
        id: media.id,
        projectId: media.projectId,
        originalName: media.originalName,
        sizeBytes: media.sizeBytes,
        duration: media.duration,
        width: media.width,
        height: media.height,
        fps: media.fps,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        container: media.container,
        bitrate: media.bitrate,
        hasVideo: media.hasVideo,
        hasAudio: media.hasAudio,
        browserPlayable: media.browserPlayable,
        hasProxy: sql<boolean>`${media.proxyPath} is not null`,
        hasThumb: sql<boolean>`${media.thumbPath} is not null`,
        chatCount: media.chatCount,
        sourceType: media.sourceType,
        createdAt: media.createdAt,
        hasTranscript: sql<boolean>`exists(select 1 from transcripts where transcripts.media_id = media.id)`,
        transcriptSource: sql<string | null>`(select source from transcripts where transcripts.media_id = media.id limit 1)`,
        clipCount: sql<number>`(select count(*)::int from clips where clips.media_id = media.id)`,
        analyzed: sql<boolean>`exists(select 1 from analyses where analyses.media_id = media.id)`,
      })
      .from(media);
    const rows = await (pid ? q.where(eq(media.projectId, Number(pid))) : q).orderBy(desc(media.id));
    return Response.json({ media: rows });
  } catch (e) {
    return jsonError(e);
  }
}
