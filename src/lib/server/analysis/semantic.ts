import type { Category, Cue, Signal } from "@/lib/shared/types";
import { CATEGORIES } from "@/lib/shared/types";
import { clamp, fmtTime } from "@/lib/shared/time";
import { extractJson, type LLMProvider } from "../ai/providers";
import { CancelledError } from "../errors";

export interface LLMHighlight {
  start: number;
  end: number;
  type: string;
  score: number;
  title: string;
  reason: string;
  complete: boolean;
}

export interface SemanticResult {
  highlights: LLMHighlight[];
  signals: Signal[];
  categoryVotes: Record<string, number>;
  warnings: string[];
  failedChunks: number;
  totalChunks: number;
}

const GUIDE: Record<Category, string> = {
  gaming: "kills, clutch plays, wins, funny fails, big reactions to gameplay events",
  comedy: "jokes with their setup and punchline, absurd or funny situations",
  podcast: "insightful statements, strong opinions, surprising claims, memorable quotable lines",
  reaction: "strong or funny reactions, notable commentary on what is being watched",
  irl: "unexpected encounters, funny interactions, surprising events",
  drama: "arguments, confrontations, accusations, controversial statements, revelations",
  sports: "decisive plays, scoring moments, celebrations, dramatic turnarounds",
  storytelling: "complete mini-stories with a hook, build-up and payoff",
  general: "any moment that is funny, surprising, emotional, insightful or dramatic",
};

const SYSTEM = `You are an expert short-form video editor finding the best clip-worthy moments in a transcript.
Return ONLY valid JSON, no commentary, in this exact shape:
{"category":"gaming|comedy|podcast|reaction|irl|drama|sports|storytelling|general",
 "highlights":[{"start":<seconds>,"end":<seconds>,"type":"joke|punchline|story|argument|revelation|reaction|insight|gameplay|other","score":<0-100>,"title":"<max 8 words>","reason":"<one sentence why this works as a clip>","complete":<true if the moment has context + payoff and makes sense alone>}]}
Rules: use the absolute timestamps shown in brackets [mm:ss]. A good clip includes setup before the payoff and ends right after it. Do not select moments only because they are loud. Prefer self-contained moments. If nothing is notable return an empty highlights array.`;

function chunkSegments(segments: Cue[], maxChars = 7000, maxSpan = 420): Cue[][] {
  const chunks: Cue[][] = [];
  let cur: Cue[] = [];
  let chars = 0;
  for (const s of segments) {
    if (cur.length && (chars + s.text.length > maxChars || s.end - cur[0].start > maxSpan)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.text.length + 8;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export async function analyzeWithLLM(opts: {
  llm: LLMProvider;
  segments: Cue[];
  keywords: string[];
  categoryHint: Category | "auto";
  signal?: AbortSignal;
  onProgress?: (f: number, msg: string) => void;
}): Promise<SemanticResult> {
  const chunks = chunkSegments(opts.segments);
  const res: SemanticResult = { highlights: [], signals: [], categoryVotes: {}, warnings: [], failedChunks: 0, totalChunks: chunks.length };
  const validCats = new Set(CATEGORIES.map((c) => c.id));
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw new CancelledError();
    opts.onProgress?.(i / chunks.length, `Semantic analysis ${i + 1}/${chunks.length}`);
    const chunk = chunks[i];
    const lo = chunk[0].start;
    const hi = chunk[chunk.length - 1].end;
    const guide = opts.categoryHint !== "auto" ? `Content type: ${opts.categoryHint}. Look for: ${GUIDE[opts.categoryHint]}.` : "First infer the content type, then look for moments appropriate to it (" + Object.entries(GUIDE).map(([k, v]) => `${k}: ${v}`).join("; ") + ").";
    const kw = opts.keywords.length ? `\nAlso flag any moments relating to these user topics: ${opts.keywords.join(", ")}.` : "";
    const user = `${guide}${kw}\n\nTranscript (${fmtTime(lo)}–${fmtTime(hi)}):\n${chunk.map((s) => `[${fmtTime(s.start)}] ${s.text.trim()}`).join("\n")}`;
    try {
      const text = await opts.llm.complete({ system: SYSTEM, user, maxTokens: 1800 }, opts.signal);
      const j = extractJson<{ category?: string; highlights?: Partial<LLMHighlight>[] }>(text);
      if (!j) throw new Error("Model did not return valid JSON");
      if (j.category && validCats.has(j.category as Category)) res.categoryVotes[j.category] = (res.categoryVotes[j.category] ?? 0) + (hi - lo);
      for (const h of j.highlights ?? []) {
        const start = Number(h.start);
        const end = Number(h.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const hl: LLMHighlight = {
          start: clamp(start, lo, hi),
          end: clamp(end, lo, hi + 5),
          type: String(h.type ?? "other"),
          score: clamp(Number(h.score) || 50, 0, 100),
          title: String(h.title ?? "").slice(0, 80),
          reason: String(h.reason ?? "").slice(0, 240),
          complete: !!h.complete,
        };
        res.highlights.push(hl);
        res.signals.push({ family: "semantic", kind: `llm_${hl.type}`, time: hl.start, end: hl.end, intensity: clamp(hl.score / 100, 0.1, 1), label: `AI: ${hl.reason || hl.title || hl.type}` });
      }
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      res.failedChunks++;
      const msg = e instanceof Error ? e.message : String(e);
      if (res.warnings.length < 3) res.warnings.push(`Semantic analysis failed for ${fmtTime(lo)}–${fmtTime(hi)}: ${msg}`);
      // Credential / privacy / model errors will fail every chunk: stop early.
      const code = (e as { code?: string }).code;
      if (code && ["invalid_key", "privacy_blocked", "model_not_found", "missing_credentials"].includes(code)) {
        res.failedChunks = chunks.length;
        break;
      }
    }
  }
  return res;
}

/** Optional vision pass on a few candidate frames (requires a vision-capable model). */
export async function describeFrame(llm: LLMProvider, jpegB64: string, context: string, signal?: AbortSignal): Promise<{ notable: boolean; description: string; score: number } | null> {
  const text = await llm.complete(
    {
      model: llm.visionModel || llm.model,
      system: 'You analyse a single video frame for a clip editor. Reply ONLY with JSON: {"notable":boolean,"description":"<max 20 words: visible facial expression, reaction or on-screen event>","score":<0-1 visual interest>}',
      user: `Context: ${context}`,
      images: [{ mime: "image/jpeg", b64: jpegB64 }],
      maxTokens: 200,
    },
    signal,
  );
  const j = extractJson<{ notable?: boolean; description?: string; score?: number }>(text);
  if (!j) return null;
  return { notable: !!j.notable, description: String(j.description ?? "").slice(0, 160), score: clamp(Number(j.score) || 0, 0, 1) };
}
