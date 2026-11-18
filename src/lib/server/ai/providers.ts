import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AppSettings, Cue } from "@/lib/shared/types";
import { CancelledError } from "../errors";
import { getApiKey, getSettings } from "../settings";

export type AIErrorCode =
  | "missing_credentials"
  | "invalid_key"
  | "rate_limited"
  | "network"
  | "unavailable"
  | "model_not_found"
  | "privacy_blocked"
  | "bad_response"
  | "not_configured";

export class AIError extends Error {
  code: AIErrorCode;
  retryable: boolean;
  constructor(code: AIErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".local");
  } catch {
    return false;
  }
}

/** Never send media-derived data to a remote provider without explicit opt-in. */
export function assertCloudAllowed(baseUrl: string, settings: AppSettings, what: string): void {
  if (isLocalUrl(baseUrl)) return;
  if (!settings.privacy.allowCloud)
    throw new AIError(
      "privacy_blocked",
      `Blocked: ${what} would be sent to ${new URL(baseUrl).hostname}. Enable “Allow sending data to cloud AI providers” in Settings → Privacy, or use a local provider.`,
    );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new CancelledError());
    });
  });

async function aiFetch(url: string, init: RequestInit, opts: { signal?: AbortSignal; retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let last: AIError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new CancelledError();
    try {
      const signals = [AbortSignal.timeout(opts.timeoutMs ?? 180_000)];
      if (opts.signal) signals.push(opts.signal);
      const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
      if (res.ok) return res;
      const body = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new AIError("invalid_key", `The provider rejected the API key (HTTP ${res.status}). Check it in Settings.`);
      if (res.status === 404) throw new AIError("model_not_found", `Endpoint or model not found (HTTP 404). ${body}`);
      if (res.status === 429) {
        last = new AIError("rate_limited", "Rate limited by the AI provider.", true);
        const ra = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        if (attempt < retries) await sleep(Math.min(ra, 20) * 1000, opts.signal);
        continue;
      }
      if (res.status >= 500) {
        last = new AIError("unavailable", `The AI provider is unavailable (HTTP ${res.status}).`, true);
        if (attempt < retries) await sleep(1500 * (attempt + 1), opts.signal);
        continue;
      }
      throw new AIError("bad_response", `Provider error HTTP ${res.status}: ${body}`);
    } catch (e) {
      if (e instanceof AIError && !e.retryable) throw e;
      if (e instanceof CancelledError || opts.signal?.aborted) throw new CancelledError();
      if (e instanceof AIError) {
        last = e;
        continue;
      }
      last = new AIError("network", `Network error contacting the AI provider: ${e instanceof Error ? e.message : String(e)}`, true);
      if (attempt < retries) await sleep(1000 * (attempt + 1), opts.signal);
    }
  }
  throw last ?? new AIError("unavailable", "AI request failed.");
}

const join = (base: string, p: string) => `${base.replace(/\/+$/, "")}${p}`;

/* ------------------------------ LLM ------------------------------ */

export interface LLMRequest {
  system: string;
  user: string;
  images?: { mime: string; b64: string }[];
  maxTokens?: number;
  model?: string;
}

export interface LLMProvider {
  id: string;
  model: string;
  visionModel: string;
  complete(req: LLMRequest, signal?: AbortSignal): Promise<string>;
}

function llmProvider(s: AppSettings, key: string | null): LLMProvider {
  const { provider, baseUrl, model, visionModel } = s.llm;
  if (provider === "anthropic") {
    const base = baseUrl.includes("anthropic") ? baseUrl : "https://api.anthropic.com/v1";
    return {
      id: "anthropic",
      model,
      visionModel,
      async complete(req, signal) {
        assertCloudAllowed(base, s, req.images?.length ? "transcript text and video frames" : "transcript text");
        const content: unknown[] = (req.images ?? []).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } }));
        content.push({ type: "text", text: req.user });
        const res = await aiFetch(
          join(base, "/messages"),
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key ?? "", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: req.model ?? model, max_tokens: req.maxTokens ?? 2000, system: req.system, messages: [{ role: "user", content }] }),
          },
          { signal },
        );
        const j = (await res.json()) as { content?: { type: string; text?: string }[] };
        const text = j.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "";
        if (!text) throw new AIError("bad_response", "The provider returned an empty response.");
        return text;
      },
    };
  }
  return {
    id: "openai-compatible",
    model,
    visionModel,
    async complete(req, signal) {
      assertCloudAllowed(baseUrl, s, req.images?.length ? "transcript text and video frames" : "transcript text");
      const userContent: unknown = req.images?.length
        ? [{ type: "text", text: req.user }, ...req.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } }))]
        : req.user;
      const res = await aiFetch(
        join(baseUrl, "/chat/completions"),
        {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({
            model: req.model ?? model,
            temperature: 0.2,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: userContent },
            ],
          }),
        },
        { signal },
      );
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) throw new AIError("bad_response", "The provider returned an empty response.");
      return text;
    },
  };
}

/** Returns null when the app is configured to use the built-in heuristic analyzer. */
export async function getLLM(): Promise<{ llm: LLMProvider | null; reason?: string }> {
  const s = await getSettings();
  if (s.llm.provider === "heuristic") return { llm: null, reason: "Semantic AI provider set to built-in heuristics." };
  if (!s.llm.model.trim()) return { llm: null, reason: "No semantic AI model selected in Settings." };
  const key = await getApiKey("llm");
  if (!key && !isLocalUrl(s.llm.baseUrl)) return { llm: null, reason: "Semantic AI API key is missing (Settings → AI Providers)." };
  return { llm: llmProvider(s, key) };
}

export async function listModels(provider: string, baseUrl: string, key: string | null): Promise<string[]> {
  const settings = await getSettings();
  assertCloudAllowed(baseUrl, settings, "a model-list request (no media data)");
  const headers: Record<string, string> =
    provider === "anthropic" ? { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" } : key ? { authorization: `Bearer ${key}` } : {};
  const base = provider === "anthropic" && !baseUrl.includes("anthropic") ? "https://api.anthropic.com/v1" : baseUrl;
  const res = await aiFetch(join(base, "/models"), { headers }, { retries: 1, timeoutMs: 20_000 });
  const j = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
  const ids = (j.data ?? []).map((m) => m.id).concat((j.models ?? []).map((m) => m.id ?? m.name ?? "")).filter(Boolean);
  return [...new Set(ids)].sort();
}

/* --------------------------- Transcription --------------------------- */

export interface TranscribeResult {
  segments: Cue[];
  language?: string;
}

export interface Transcriber {
  id: string;
  chunkFormat: "mp3" | "wav";
  transcribe(file: string, opts: { language?: string; signal?: AbortSignal; chunkDuration: number }): Promise<TranscribeResult>;
}

function openAiTranscriber(s: AppSettings, key: string | null): Transcriber {
  const { baseUrl, model } = s.transcription;
  return {
    id: "openai-compatible",
    chunkFormat: "mp3",
    async transcribe(file, opts) {
      assertCloudAllowed(baseUrl, s, "the audio track");
      const buf = fs.readFileSync(file);
      const attempt = async (format: "verbose_json" | "json") => {
        const form = new FormData();
        form.append("file", new Blob([buf]), path.basename(file));
        form.append("model", model);
        form.append("response_format", format);
        if (format === "verbose_json") form.append("timestamp_granularities[]", "segment");
        if (opts.language) form.append("language", opts.language);
        const res = await aiFetch(
          join(baseUrl, "/audio/transcriptions"),
          { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form },
          { signal: opts.signal, timeoutMs: 600_000 },
        );
        return (await res.json()) as { text?: string; language?: string; segments?: { start: number; end: number; text: string }[] };
      };
      let j;
      try {
        j = await attempt("verbose_json");
      } catch (e) {
        if (e instanceof AIError && e.code === "bad_response") j = await attempt("json");
        else throw e;
      }
      const segs: Cue[] = (j.segments ?? []).map((x) => ({ start: x.start, end: x.end, text: x.text.trim() })).filter((x) => x.text);
      if (!segs.length && j.text?.trim()) segs.push({ start: 0, end: opts.chunkDuration, text: j.text.trim() });
      return { segments: segs, language: j.language };
    },
  };
}

function whisperCppTranscriber(s: AppSettings): Transcriber {
  const { whisperBinary, whisperModel } = s.transcription;
  return {
    id: "whisper-cpp",
    chunkFormat: "wav",
    async transcribe(file, opts) {
      const outBase = file.replace(/\.[^.]+$/, "");
      const args = ["-m", whisperModel, "-f", file, "-oj", "-of", outBase, "-l", opts.language || "auto"];
      await new Promise<void>((resolve, reject) => {
        const c = spawn(whisperBinary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        opts.signal?.addEventListener("abort", () => c.kill("SIGKILL"), { once: true });
        c.stderr.on("data", (d) => (err = (err + d).slice(-800)));
        c.on("error", (e) => reject(new AIError("unavailable", `Could not start whisper.cpp (${whisperBinary}): ${e.message}`)));
        c.on("close", (code) => {
          if (opts.signal?.aborted) return reject(new CancelledError());
          code === 0 ? resolve() : reject(new AIError("unavailable", `whisper.cpp exited with code ${code}. ${err.split("\n").pop() ?? ""}`));
        });
      });
      const jsonFile = `${outBase}.json`;
      if (!fs.existsSync(jsonFile)) throw new AIError("bad_response", "whisper.cpp did not produce a JSON transcript.");
      const j = JSON.parse(fs.readFileSync(jsonFile, "utf8")) as {
        result?: { language?: string };
        transcription?: { offsets: { from: number; to: number }; text: string }[];
      };
      const segments = (j.transcription ?? [])
        .map((t) => ({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: t.text.trim() }))
        .filter((t) => t.text && t.end > t.start);
      return { segments, language: j.result?.language };
    },
  };
}

export async function getTranscriber(): Promise<{ transcriber: Transcriber | null; reason?: string }> {
  const s = await getSettings();
  const t = s.transcription;
  if (t.provider === "none") return { transcriber: null, reason: "No speech-recognition provider is configured (Settings → AI Providers)." };
  if (t.provider === "whisper-cpp") {
    if (!t.whisperBinary || !fs.existsSync(t.whisperBinary)) return { transcriber: null, reason: "whisper.cpp executable path is missing or invalid." };
    if (!t.whisperModel || !fs.existsSync(t.whisperModel)) return { transcriber: null, reason: "whisper.cpp model file path is missing or invalid." };
    return { transcriber: whisperCppTranscriber(s) };
  }
  if (!t.model.trim()) return { transcriber: null, reason: "No transcription model selected in Settings." };
  const key = await getApiKey("transcription");
  if (!key && !isLocalUrl(t.baseUrl)) return { transcriber: null, reason: "Transcription API key is missing (Settings → AI Providers)." };
  return { transcriber: openAiTranscriber(s, key) };
}

/* ------------------------------ JSON util ------------------------------ */

export function extractJson<T = unknown>(text: string): T | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.search(/[{[]/);
    if (start < 0) continue;
    const open = c[start];
    const close = open === "{" ? "}" : "]";
    const end = c.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      /* try next */
    }
  }
  return null;
}
