import { getKeyStatus, getSettings, saveSettings } from "@/lib/server/settings";
import { jsonError, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ settings: await getSettings(), keys: await getKeyStatus() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await readJson<{ settings?: Record<string, unknown>; keys?: Record<string, string | null> }>(req);
    const keys: Record<string, string | null> = {};
    for (const k of ["transcription", "llm"]) {
      const v = body.keys?.[k];
      if (v === undefined) continue;
      if (v !== null && typeof v !== "string") throw new AppError("bad_key", "Invalid API key value.");
      keys[k] = v;
    }
    const settings = await saveSettings(body.settings ?? {}, keys);
    return Response.json({ settings, keys: await getKeyStatus() });
  } catch (e) {
    return jsonError(e);
  }
}
