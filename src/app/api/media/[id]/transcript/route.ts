import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media, transcripts } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { parseSrt } from "@/lib/shared/time";
import type { Cue } from "@/lib/shared/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [t] = await db.select().from(transcripts).where(eq(transcripts.mediaId, id));
    return Response.json({ transcript: t ?? null });
  } catch (e) {
    return jsonError(e);
  }
}

/** POST { srt } imports an existing subtitle file as the transcript. PUT { segments } saves edits. */
async function save(mediaId: number, segments: Cue[], source: string) {
  const [m] = await db.select({ id: media.id }).from(media).where(eq(media.id, mediaId));
  if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
  await db.delete(transcripts).where(eq(transcripts.mediaId, mediaId));
  const [t] = await db.insert(transcripts).values({ mediaId, segments, source }).returning();
  return t;
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const { srt } = await readJson<{ srt?: string }>(req);
    if (!srt) throw new AppError("bad_request", "Subtitle content is required.");
    const cues = parseSrt(srt);
    if (!cues.length) throw new AppError("bad_srt", "No valid subtitle cues were found. Only SRT files are supported.");
    return Response.json({ transcript: await save(id, cues, "srt-import") }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const { segments } = await readJson<{ segments?: Cue[] }>(req);
    if (!Array.isArray(segments)) throw new AppError("bad_request", "segments must be an array.");
    const clean = segments
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && typeof s.text === "string")
      .map((s) => ({ start: s.start, end: s.end, text: s.text.slice(0, 1000) }));
    return Response.json({ transcript: await save(id, clean, "edited") });
  } catch (e) {
    return jsonError(e);
  }
}
