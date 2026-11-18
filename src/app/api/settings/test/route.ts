import path from "node:path";
import fs from "node:fs";
import { getLLM, getTranscriber, listModels } from "@/lib/server/ai/providers";
import { getApiKey, getSettings } from "@/lib/server/settings";
import { jsonError, readJson } from "@/lib/server/http";
import { runFFmpeg } from "@/lib/server/ffmpeg";
import { rmSafe, tmpDirFor } from "@/lib/server/paths";
import { AppError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

/** POST { action: "test" | "models", target: "llm" | "transcription" } — uses saved settings & key. */
export async function POST(req: Request) {
  try {
    const { action, target } = await readJson<{ action: string; target: "llm" | "transcription" }>(req);
    const settings = await getSettings();
    if (action === "models") {
      const cfg = target === "llm" ? settings.llm : settings.transcription;
      const provider = target === "llm" ? settings.llm.provider : "openai-compatible";
      if (provider === "heuristic" || cfg.baseUrl === undefined) throw new AppError("not_applicable", "Select a provider first.");
      const key = await getApiKey(target);
      const models = await listModels(provider, cfg.baseUrl, key);
      return Response.json({ models });
    }
    const t0 = Date.now();
    if (target === "llm") {
      const { llm, reason } = await getLLM();
      if (!llm) throw new AppError("not_configured", reason ?? "Not configured.");
      const text = await llm.complete({ system: "You are a connectivity test.", user: "Reply with the single word OK.", maxTokens: 20 });
      return Response.json({ ok: true, ms: Date.now() - t0, detail: `${llm.id} · ${llm.model} replied: ${text.trim().slice(0, 40)}` });
    }
    const { transcriber, reason } = await getTranscriber();
    if (!transcriber) throw new AppError("not_configured", reason ?? "Not configured.");
    const tmp = tmpDirFor("test");
    try {
      const f = path.join(tmp, `t.${transcriber.chunkFormat}`);
      await runFFmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "16000", "-ac", "1", f]);
      if (!fs.existsSync(f)) throw new AppError("test_failed", "Could not create a test audio file.");
      await transcriber.transcribe(f, { chunkDuration: 2 });
      return Response.json({ ok: true, ms: Date.now() - t0, detail: `${transcriber.id} accepted a test audio file.` });
    } finally {
      rmSafe(tmp);
    }
  } catch (e) {
    return jsonError(e);
  }
}
