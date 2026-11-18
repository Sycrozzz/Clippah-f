import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, clips, media, transcripts } from "@/db/schema";
import type { AnalysisConfig, AppSettings, Category, Cue, Signal, SignalFamily } from "@/lib/shared/types";
import { CATEGORIES } from "@/lib/shared/types";
import { DEFAULT_AUDIO, DEFAULT_CROP } from "@/lib/shared/defaults";
import { fmtTime } from "@/lib/shared/time";
import { AppError, CancelledError } from "../errors";
import { assertDisk, probe, runFFmpeg } from "../ffmpeg";
import { dirs, rmSafe, tmpDirFor } from "../paths";
import type { JobContext } from "../queue";
import { getSettings } from "../settings";
import { AIError, getLLM } from "../ai/providers";
import { analyzeAudio, detectAudioEvents, type AudioAnalysis } from "./audio";
import { analyzeVisual, detectVisualEvents } from "./visual";
import { transcribeMedia } from "./transcript";
import { analyzeTranscriptHeuristic, findKeywordMatches, speechDensity } from "./text";
import { analyzeChat, type ChatMessage } from "./chat";
import { classifyHeuristic } from "./category";
import { analyzeWithLLM, describeFrame, type LLMHighlight } from "./semantic";
import { proposeClips } from "./scoring";
import { cuesInRange, refreshClipThumb } from "../clips";

export function buildAnalysisConfig(settings: AppSettings, partial: Partial<AnalysisConfig> = {}): AnalysisConfig {
  const c = settings.clips;
  const minD = Math.max(3, Number(partial.minDuration ?? c.minDuration));
  const maxD = Math.max(minD, Number(partial.maxDuration ?? c.maxDuration));
  return {
    keywords: (partial.keywords ?? []).map((k) => String(k).trim()).filter(Boolean).slice(0, 30),
    categoryOverride: partial.categoryOverride ?? "auto",
    minDuration: minD,
    maxDuration: maxD,
    targetDuration: Math.min(maxD, Math.max(minD, Number(partial.targetDuration ?? c.targetDuration))),
    maxClips: Math.max(1, Math.min(100, Number(partial.maxClips ?? c.maxClips))),
    adaptive: partial.adaptive ?? c.adaptive,
    weights: { ...settings.weights, ...(partial.weights ?? {}) },
    language: partial.language ?? settings.transcription.language,
    useChat: partial.useChat ?? true,
    useVision: partial.useVision ?? settings.llm.useVision,
    retranscribe: partial.retranscribe ?? false,
    replaceExisting: partial.replaceExisting ?? true,
  };
}

const catLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c;

export async function runAnalysisJob(ctx: JobContext): Promise<void> {
  const settings = await getSettings();
  const config = buildAnalysisConfig(settings, ctx.job.config as Partial<AnalysisConfig>);
  const [m] = await db.select().from(media).where(eq(media.id, ctx.job.mediaId!));
  if (!m) throw new AppError("not_found", "The media for this analysis no longer exists.", { status: 404 });
  if (!fs.existsSync(m.filePath))
    throw new AppError("file_missing", `The source file is missing: ${m.filePath}`, { hint: "It may have been moved or deleted. Re-import the media." });

  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    ctx.log("warn", msg);
  };
  const check = () => {
    if (ctx.signal.aborted) throw new CancelledError();
  };

  await assertDisk(dirs.tmp, 300e6);
  const tmp = tmpDirFor(`analysis-${m.id}`);
  try {
    ctx.update({ stage: "Validating media", progress: 0.01, message: m.originalName });
    const info = await probe(m.filePath).catch((e) => {
      throw new AppError("media_unreadable", `The media could not be read: ${e instanceof Error ? e.message : e}`);
    });
    const duration = info.duration || m.duration;

    /* ---------- audio + visual analysis (parallel, streamed) ---------- */
    ctx.update({ stage: "Analyzing audio & video", progress: 0.03, message: "Detecting loudness, laughter, scene changes and motion" });
    let aProg = 0;
    let vProg = 0;
    const streams = (m.hasAudio ? 1 : 0) + (m.hasVideo ? 1 : 0);
    const bump = () => ctx.update({ progress: 0.03 + (0.4 * (aProg + vProg)) / Math.max(1, streams) });
    const audioP: Promise<AudioAnalysis | null> = m.hasAudio
      ? analyzeAudio(m.filePath, { duration, signal: ctx.signal, onProgress: (f) => ((aProg = f), bump()) })
          .then((f) => detectAudioEvents(f))
          .catch((e) => {
            if (e instanceof CancelledError) throw e;
            warn(`Audio analysis failed: ${e instanceof Error ? e.message : e}`);
            return null;
          })
      : Promise.resolve(null);
    const visualP = m.hasVideo
      ? analyzeVisual(m.filePath, { duration, signal: ctx.signal, onProgress: (f) => ((vProg = f), bump()) })
          .then((v) => ({ v, d: detectVisualEvents(v) }))
          .catch((e) => {
            if (e instanceof CancelledError) throw e;
            warn(`Visual analysis failed: ${e instanceof Error ? e.message : e}`);
            return null;
          })
      : Promise.resolve(null);
    const [audio, visual] = await Promise.all([audioP, visualP]);
    check();

    const signals: Signal[] = [];
    if (audio) {
      signals.push(...audio.signals);
      const notable = audio.signals.filter((s) => s.kind !== "volume_spike").sort((a, b) => b.intensity - a.intensity).slice(0, 6);
      ctx.log("info", `Audio: ${audio.signals.length} events (speech ${(audio.stats.speechRatio * 100).toFixed(0)}% of runtime)`);
      for (const s of notable) ctx.log("event", `${fmtTime(s.time)} · ${s.label}`);
    }
    if (visual) {
      signals.push(...visual.d.signals);
      ctx.log("info", `Video: ${visual.v.cuts.length} scene changes, ${visual.d.signals.filter((s) => s.kind === "motion_burst").length} action bursts`);
      for (const s of visual.d.signals.filter((x) => x.kind === "motion_burst").slice(0, 4)) ctx.log("event", `${fmtTime(s.time)} · ${s.label}`);
    }

    /* ---------- transcription ---------- */
    let segments: Cue[] = [];
    let transcriptSource = "none";
    const [existing] = await db.select().from(transcripts).where(eq(transcripts.mediaId, m.id));
    if (existing && !config.retranscribe) {
      segments = existing.segments;
      transcriptSource = existing.source;
      ctx.log("info", `Using existing transcript (${existing.source}, ${segments.length} segments)`);
    } else if (m.hasAudio) {
      ctx.update({ stage: "Transcribing speech", progress: 0.45, message: "Speech recognition" });
      try {
        const r = await transcribeMedia({
          file: m.filePath,
          duration,
          tmpDir: tmp,
          language: config.language,
          signal: ctx.signal,
          onProgress: (f, msg) => ctx.update({ progress: 0.45 + 0.33 * f, message: msg ?? "Transcribing" }),
        });
        segments = r.segments;
        transcriptSource = r.provider;
        await db.delete(transcripts).where(eq(transcripts.mediaId, m.id));
        await db.insert(transcripts).values({ mediaId: m.id, segments, language: r.language ?? null, source: r.provider });
        ctx.log("info", `Transcribed ${segments.length} segments`);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        const msg = e instanceof AIError || e instanceof AppError ? e.message : `Transcription failed: ${e instanceof Error ? e.message : e}`;
        if (existing?.segments.length) {
          segments = existing.segments;
          transcriptSource = existing.source;
          warn(`${msg} Keeping the existing transcript (${existing.source}).`);
        } else {
          warn(`${msg} Continuing without a transcript — semantic analysis, keywords and subtitles will be limited. You can import an .srt file instead.`);
        }
      }
    }
    check();

    /* ---------- chat ---------- */
    let chatMsgs: ChatMessage[] = [];
    if (m.chatPath && config.useChat && fs.existsSync(m.chatPath)) {
      ctx.update({ stage: "Analyzing chat", progress: 0.8 });
      chatMsgs = JSON.parse(fs.readFileSync(m.chatPath, "utf8")) as ChatMessage[];
      const c = analyzeChat(chatMsgs, duration);
      signals.push(...c.signals);
      ctx.log("info", `Chat: ${chatMsgs.length} messages, ${c.signals.length} reaction surges`);
      for (const s of c.signals.slice(0, 5)) ctx.log("event", `${fmtTime(s.time)} · ${s.label}`);
    }

    /* ---------- keywords ---------- */
    if (config.keywords.length) {
      if (!segments.length) warn("Custom keywords need a transcript to be searched; none is available.");
      else {
        const k = findKeywordMatches(segments, config.keywords);
        signals.push(...k);
        ctx.log("info", `Keywords: ${k.length} matches for ${config.keywords.join(", ")}`);
        for (const s of k.slice(0, 5)) ctx.log("event", `${fmtTime(s.time)} · ${s.label}`);
      }
    }

    /* ---------- semantic ---------- */
    let llmHighlights: LLMHighlight[] = [];
    let semanticMode = "none";
    let categoryVotes: Record<string, number> = {};
    const { llm, reason: llmReason } = await getLLM();
    const heuristic = analyzeTranscriptHeuristic(segments);
    if (segments.length) {
      let usedLLM = false;
      if (llm) {
        ctx.update({ stage: "Semantic analysis", progress: 0.82, message: `${llm.id} · ${llm.model}` });
        const r = await analyzeWithLLM({
          llm,
          segments,
          keywords: config.keywords,
          categoryHint: config.categoryOverride,
          signal: ctx.signal,
          onProgress: (f, msg) => ctx.update({ progress: 0.82 + 0.07 * f, message: msg }),
        });
        r.warnings.forEach(warn);
        if (r.failedChunks < r.totalChunks) {
          usedLLM = true;
          semanticMode = `llm:${llm.id}`;
          llmHighlights = r.highlights;
          categoryVotes = r.categoryVotes;
          signals.push(...r.signals, ...heuristic.filter((s) => s.family === "game"));
          for (const h of r.highlights.slice(0, 6)) ctx.log("event", `${fmtTime(h.start)} · AI (${h.type}): ${h.reason || h.title}`);
        } else warn("The AI provider failed for every segment; falling back to built-in heuristic text analysis.");
      } else if (llmReason) ctx.log("info", `${llmReason} Using built-in heuristic text analysis.`);
      if (!usedLLM) {
        semanticMode = "heuristic";
        signals.push(...heuristic);
        for (const s of heuristic.sort((a, b) => b.intensity - a.intensity).slice(0, 6)) ctx.log("event", `${fmtTime(s.time)} · ${s.label}`);
      }
    }
    check();

    /* ---------- category ---------- */
    ctx.update({ stage: "Scoring highlights", progress: 0.9, message: "Combining signals" });
    const heur = classifyHeuristic(segments, {
      meanMotion: visual?.d.stats.meanMotion ?? 0,
      cutsPerMin: visual?.d.stats.cutsPerMin ?? 0,
      laughterRatio: audio?.stats.laughterRatio ?? 0,
      speechRatio: audio?.stats.speechRatio ?? 0,
      hasChat: chatMsgs.length > 0,
      hasVideo: m.hasVideo,
    });
    let category: Category = heur.category;
    let categoryConfidence = heur.confidence;
    const votes = Object.entries(categoryVotes).sort((a, b) => b[1] - a[1]);
    if (votes.length) {
      category = votes[0][0] as Category;
      categoryConfidence = Math.min(0.95, votes[0][1] / Object.values(categoryVotes).reduce((a, b) => a + b, 0));
    }
    if (config.categoryOverride !== "auto") {
      category = config.categoryOverride;
      categoryConfidence = 1;
    }
    ctx.log("info", `Content category: ${catLabel(category)} (${Math.round(categoryConfidence * 100)}% confidence)`);

    /* ---------- fusion ---------- */
    const available: Record<SignalFamily, boolean> = {
      audio: !!audio,
      visual: !!visual,
      semantic: segments.length > 0,
      chat: chatMsgs.length > 0,
      game: segments.length > 0,
      keyword: config.keywords.length > 0 && segments.length > 0,
    };
    const speech = segments.length
      ? speechDensity(segments, duration)
      : Array.from({ length: Math.ceil(duration) }, (_, i) => (audio?.speechActive[i * 2] || audio?.speechActive[i * 2 + 1] ? 1 : 0));
    const scoring = proposeClips({
      duration,
      signals,
      segments,
      silences: audio?.silences ?? [],
      speech,
      available,
      category,
      config,
      llmHighlights,
    });
    if (visual) scoring.timeline.motion = visual.v.motion.slice(0, scoring.timeline.combined.length).map((v) => +Math.min(1, v * 3).toFixed(3));
    ctx.log("info", `Found ${scoring.proposals.length} highlight${scoring.proposals.length === 1 ? "" : "s"}${scoring.weak ? " (weak signals — low confidence)" : ""}`);
    if (!scoring.proposals.length) warn("No highlights were detected. Try lowering the minimum duration, adding keywords, or enabling transcription.");

    /* ---------- optional vision verification ---------- */
    if (llm && config.useVision && settings.llm.useVision && settings.llm.visionModel && m.hasVideo) {
      ctx.update({ stage: "Visual review", progress: 0.93, message: "Checking top candidates with a vision model" });
      let failed = false;
      for (const p of scoring.proposals.slice(0, 8)) {
        if (failed) break;
        check();
        const jpg = `${tmp}/v-${Math.round(p.peak)}.jpg`;
        try {
          await runFFmpeg(["-y", "-ss", String(p.peak), "-i", m.filePath, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", jpg], { signal: ctx.signal, timeoutMs: 30000 });
          const d = await describeFrame(llm, fs.readFileSync(jpg).toString("base64"), `${catLabel(category)} video, moment: ${p.title}`, ctx.signal);
          if (d) {
            p.scores.visualNote = d.description;
            p.evidence.push({ family: "visual", kind: "vision_llm", time: p.peak, label: `Vision model: ${d.description}`, strength: d.score });
            if (d.notable) {
              p.score = Math.min(100, p.score + Math.round(8 * d.score));
              p.confidence = Math.min(0.95, +(p.confidence + 0.08).toFixed(2));
            }
          }
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          failed = true;
          warn(`Vision review skipped: ${e instanceof Error ? e.message : e}`);
        }
      }
      scoring.proposals.sort((a, b) => b.score - a.score);
    }

    /* ---------- persist ---------- */
    ctx.update({ stage: "Saving clips", progress: 0.96, message: "Generating thumbnails" });
    const [analysis] = await db
      .insert(analyses)
      .values({
        mediaId: m.id,
        jobId: ctx.job.id,
        category,
        categoryConfidence,
        categoryScores: heur.scores,
        timeline: scoring.timeline,
        signals: signals.filter((s) => s.kind !== "scene_change").slice(0, 4000),
        config,
        summary: {
          warnings,
          transcriptSource,
          semanticMode,
          available,
          silences: (audio?.silences ?? []).slice(0, 5000),
          llmHighlights,
          audioStats: audio?.stats ?? null,
          visualStats: visual?.d.stats ?? null,
          chatMessages: chatMsgs.length,
          weak: scoring.weak,
        },
      })
      .returning();

    if (config.replaceExisting) await db.delete(clips).where(and(eq(clips.mediaId, m.id), eq(clips.source, "ai"), eq(clips.status, "pending")));
    const created: number[] = [];
    let rank = 1;
    for (const p of scoring.proposals) {
      const cues = cuesInRange(segments, p.start, p.end);
      const [row] = await db
        .insert(clips)
        .values({
          projectId: m.projectId,
          mediaId: m.id,
          analysisId: analysis.id,
          title: p.title,
          startSec: p.start,
          endSec: p.end,
          peakSec: p.peak,
          score: p.score,
          confidence: p.confidence,
          category: p.category,
          reason: p.reason,
          evidence: p.evidence,
          scores: p.scores,
          rank: rank++,
          aspect: "9:16",
          crop: DEFAULT_CROP,
          audio: DEFAULT_AUDIO,
          subtitles: { enabled: cues.length > 0, cues, style: settings.subtitles },
        })
        .returning({ id: clips.id });
      created.push(row.id);
    }
    for (const id of created) {
      check();
      await refreshClipThumb(id);
      ctx.update({ progress: 0.96 + (0.04 * (created.indexOf(id) + 1)) / created.length });
    }
    ctx.setResult({ analysisId: analysis.id, clips: created.length, category, warnings, semanticMode, transcriptSource });
    ctx.log("info", `Done — ${created.length} clips ready for review`);
  } finally {
    if (!settings.privacy.keepTempFiles) rmSafe(tmp);
  }
}
