import { detectHardware, freeDiskBytes } from "@/lib/server/ffmpeg";
import { DATA_DIR, ensureDirs } from "@/lib/server/paths";
import { findYtDlp } from "@/lib/server/download";
import { getSettings, getKeyStatus } from "@/lib/server/settings";
import { getLLM, getTranscriber } from "@/lib/server/ai/providers";
import { ensureQueue } from "@/lib/server/queue";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureDirs();
    await ensureQueue();
    const [hw, settings, keys, llm, tr] = await Promise.all([detectHardware(), getSettings(), getKeyStatus(), getLLM(), getTranscriber()]);
    return Response.json({
      hardware: hw,
      dataDir: DATA_DIR,
      diskFreeBytes: await freeDiskBytes(DATA_DIR),
      ytDlp: !!findYtDlp(settings.sources.ytDlpPath),
      ai: {
        transcription: { ready: !!tr.transcriber, reason: tr.reason ?? null },
        semantic: { ready: !!llm.llm, reason: llm.reason ?? null },
        keys,
        allowCloud: settings.privacy.allowCloud,
      },
      theme: settings.appearance.theme,
    });
  } catch (e) {
    return jsonError(e);
  }
}
