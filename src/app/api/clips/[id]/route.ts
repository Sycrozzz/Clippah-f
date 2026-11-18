import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, media } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { refreshClipThumb } from "@/lib/server/clips";
import { parseAspect } from "@/lib/shared/presets";
import { clamp } from "@/lib/shared/time";
import { rmSafe } from "@/lib/server/paths";
import type { AudioSettings, ClipSubtitles, CropSettings } from "@/lib/shared/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [row] = await db
      .select({ clip: clips, mediaName: media.originalName, duration: media.duration, width: media.width, height: media.height, hasVideo: media.hasVideo, hasAudio: media.hasAudio, browserPlayable: media.browserPlayable, hasProxy: media.proxyPath })
      .from(clips)
      .innerJoin(media, eq(clips.mediaId, media.id))
      .where(eq(clips.id, id));
    if (!row) throw new AppError("not_found", "Clip not found", { status: 404 });
    const { clip, hasProxy, ...rest } = row;
    const { thumbPath: _t, ...c } = clip;
    void _t;
    return Response.json({ clip: c, media: { ...rest, hasProxy: !!hasProxy } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const b = await readJson<{
      title?: string;
      startSec?: number;
      endSec?: number;
      status?: string;
      aspect?: string;
      crop?: CropSettings;
      audio?: AudioSettings;
      subtitles?: ClipSubtitles;
    }>(req);
    const [cur] = await db.select().from(clips).where(eq(clips.id, id));
    if (!cur) throw new AppError("not_found", "Clip not found", { status: 404 });
    const [m] = await db.select().from(media).where(eq(media.id, cur.mediaId));
    const set: Partial<typeof clips.$inferInsert> = { updatedAt: new Date() };
    if (b.title !== undefined) {
      if (!b.title.trim()) throw new AppError("bad_title", "Clip title cannot be empty.");
      set.title = b.title.trim().slice(0, 120);
    }
    let timesChanged = false;
    if (b.startSec !== undefined || b.endSec !== undefined) {
      const s = Number(b.startSec ?? cur.startSec);
      const e = Number(b.endSec ?? cur.endSec);
      const dur = m?.duration ?? Infinity;
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > dur + 0.05 || e - s < 1)
        throw new AppError("bad_range", `Start/end must be within the media (0–${dur.toFixed(1)}s) and at least 1 second apart.`);
      set.startSec = s;
      set.endSec = Math.min(e, dur);
      timesChanged = s !== cur.startSec || e !== cur.endSec;
    }
    if (b.status !== undefined) {
      if (!["pending", "approved", "rejected"].includes(b.status)) throw new AppError("bad_status", "Invalid status.");
      set.status = b.status;
    }
    if (b.aspect !== undefined) {
      if (!parseAspect(b.aspect)) throw new AppError("bad_aspect", "Aspect ratio must look like 9:16 or 21:9.");
      set.aspect = b.aspect;
    }
    if (b.crop) set.crop = { mode: b.crop.mode === "blur" ? "blur" : "crop", x: clamp(+b.crop.x || 0, 0, 1), y: clamp(+b.crop.y || 0, 0, 1), zoom: clamp(+b.crop.zoom || 1, 1, 4) };
    if (b.audio) set.audio = { volume: clamp(+b.audio.volume, 0, 4), mute: !!b.audio.mute, fadeIn: clamp(+b.audio.fadeIn || 0, 0, 10), fadeOut: clamp(+b.audio.fadeOut || 0, 0, 10), normalize: !!b.audio.normalize };
    if (b.subtitles) {
      set.subtitles = {
        enabled: !!b.subtitles.enabled,
        style: b.subtitles.style,
        cues: (b.subtitles.cues ?? []).filter((c) => c.end > c.start && typeof c.text === "string").map((c) => ({ start: +c.start, end: +c.end, text: c.text.slice(0, 500) })),
      };
    }
    const [row] = await db.update(clips).set(set).where(eq(clips.id, id)).returning();
    if (timesChanged) void refreshClipThumb(id);
    return Response.json({ clip: row });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [c] = await db.select().from(clips).where(eq(clips.id, id));
    if (c) {
      rmSafe(c.thumbPath);
      await db.delete(clips).where(eq(clips.id, id));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
