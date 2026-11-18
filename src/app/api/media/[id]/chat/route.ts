import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { jsonError, readJson, toId } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { parseChatLog } from "@/lib/server/analysis/chat";
import { dirs, ensureDirs, rmSafe } from "@/lib/server/paths";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST { content } — attach an authorised chat log (Twitch/Kick export) for chat-reaction analysis. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const { content } = await readJson<{ content?: string }>(req);
    if (!content) throw new AppError("bad_request", "Chat log content is required.");
    const [m] = await db.select().from(media).where(eq(media.id, id));
    if (!m) throw new AppError("not_found", "Media not found", { status: 404 });
    let msgs;
    try {
      msgs = parseChatLog(content);
    } catch (e) {
      throw new AppError("bad_chat", e instanceof Error ? e.message : "Could not read chat log.");
    }
    ensureDirs();
    const file = path.join(dirs.chat, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(msgs));
    await db.update(media).set({ chatPath: file, chatCount: msgs.length }).where(eq(media.id, id));
    return Response.json({ count: msgs.length, lastTimestamp: msgs[msgs.length - 1].t }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const id = toId((await params).id);
    const [m] = await db.select().from(media).where(eq(media.id, id));
    rmSafe(m?.chatPath);
    await db.update(media).set({ chatPath: null, chatCount: 0 }).where(eq(media.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
