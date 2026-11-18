import { describe, expect, it } from "vitest";
import { formatSrt, parseSrt, parseTime, fmtTime } from "@/lib/shared/time";
import { outputSize, parseAspect, applyPreset } from "@/lib/shared/presets";
import { DEFAULT_EXPORT, DEFAULT_SETTINGS, DEFAULT_SUBTITLE_STYLE, DEFAULT_AUDIO, DEFAULT_CROP } from "@/lib/shared/defaults";
import { analyzeTranscriptHeuristic, findKeywordMatches } from "@/lib/server/analysis/text";
import { analyzeChat, parseChatLog } from "@/lib/server/analysis/chat";
import { classifyHeuristic } from "@/lib/server/analysis/category";
import { detectAudioEvents, type AudioFeatures } from "@/lib/server/analysis/audio";
import { buildTimeline, proposeClips, regenerateBoundaries, type ScoringInput } from "@/lib/server/analysis/scoring";
import { buildAss, planRender, validateFormat } from "@/lib/server/export";
import { extractJson, isLocalUrl, assertCloudAllowed, AIError } from "@/lib/server/ai/providers";
import { sanitizeFilename } from "@/lib/server/paths";
import { encryptSecret, decryptSecret } from "@/lib/server/secrets";
import { assertPublicUrl } from "@/lib/server/download";
import type { AnalysisConfig, Cue, Signal } from "@/lib/shared/types";
import type { ClipRow } from "@/lib/server/clips";
import type { MediaRow } from "@/lib/server/media";

describe("time & subtitles", () => {
  it("round-trips SRT", () => {
    const cues: Cue[] = [
      { start: 1.5, end: 3.25, text: "Hello" },
      { start: 3661.001, end: 3665, text: "Two\nlines" },
    ];
    const parsed = parseSrt(formatSrt(cues));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].start).toBeCloseTo(1.5, 2);
    expect(parsed[1].start).toBeCloseTo(3661.001, 2);
    expect(parsed[1].text).toBe("Two\nlines");
  });
  it("parses and formats timecodes", () => {
    expect(parseTime("1:02:03.5")).toBeCloseTo(3723.5);
    expect(parseTime("bad")).toBeNull();
    expect(fmtTime(75)).toBe("1:15");
    expect(fmtTime(3725)).toBe("1:02:05");
  });
});

describe("presets & aspect", () => {
  it("computes output sizes", () => {
    expect(outputSize(9 / 16, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(16 / 9, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(4 / 5, 1080)).toEqual({ width: 1080, height: 1350 });
    expect(parseAspect("21:9")).toBeCloseTo(2.333, 2);
    expect(parseAspect("nonsense")).toBeNull();
  });
  it("applies presets", () => {
    const p = applyPreset(DEFAULT_EXPORT, "instagram-reels");
    expect(p.aspect).toBe("9:16");
    expect(p.preset).toBe("instagram-reels");
  });
  it("rejects invalid format/codec combos", () => {
    expect(() => validateFormat({ ...DEFAULT_EXPORT, format: "webm", codec: "h264" })).toThrow();
    expect(() => validateFormat({ ...DEFAULT_EXPORT, format: "mp4", codec: "h264" })).not.toThrow();
  });
});

describe("text analysis", () => {
  const segs: Cue[] = [
    { start: 10, end: 14, text: "So basically this one time I was at the airport" },
    { start: 14, end: 18, text: "NO WAY! Are you serious?!" },
    { start: 40, end: 44, text: "Bruce Wayne is my favorite, honestly" },
    { start: 60, end: 63, text: "That was a clutch ace, let's go!" },
  ];
  it("finds keywords case/punctuation insensitively", () => {
    const k = findKeywordMatches(segs, ["bruce wayne", "AIRPORT"]);
    expect(k.map((s) => s.time).sort()).toEqual([10, 40]);
    expect(k.every((s) => s.family === "keyword")).toBe(true);
  });
  it("does not match partial words", () => {
    expect(findKeywordMatches([{ start: 0, end: 2, text: "carpenter" }], ["car"])).toHaveLength(0);
  });
  it("detects semantic and game cues", () => {
    const s = analyzeTranscriptHeuristic(segs);
    expect(s.some((x) => x.kind === "surprise" && x.time === 14)).toBe(true);
    expect(s.some((x) => x.kind === "story_hook" && x.time === 10)).toBe(true);
    expect(s.some((x) => x.family === "game" && x.time === 60)).toBe(true);
  });
  it("classifies content categories", () => {
    const stats = { meanMotion: 0.1, cutsPerMin: 2, laughterRatio: 0, speechRatio: 0.5, hasChat: true, hasVideo: true };
    const g = classifyHeuristic([{ start: 0, end: 5, text: "minecraft creeper nether spawn squad ranked headshot clutch" }], stats);
    expect(g.category).toBe("gaming");
    const p = classifyHeuristic([{ start: 0, end: 5, text: "welcome back to the podcast today my guest answers a question" }], { ...stats, meanMotion: 0, hasChat: false });
    expect(p.category).toBe("podcast");
  });
});

describe("chat analysis", () => {
  it("parses TwitchDownloader-style JSON and text logs", () => {
    const j = parseChatLog(JSON.stringify({ comments: [{ content_offset_seconds: 5, commenter: { display_name: "a" }, message: { body: "KEKW" } }] }));
    expect(j[0]).toMatchObject({ t: 5, user: "a", text: "KEKW" });
    const t = parseChatLog("[00:01:05] bob: LUL\n[00:01:06] amy: LUL");
    expect(t).toHaveLength(2);
    expect(t[0].t).toBe(65);
    expect(() => parseChatLog("nothing useful")).toThrow();
  });
  it("detects a chat surge aligned to video time", () => {
    const msgs = [];
    for (let t = 0; t < 300; t += 4) msgs.push({ t, user: `u${t}`, text: "hi there" });
    for (let i = 0; i < 80; i++) msgs.push({ t: 150 + i * 0.1, user: `x${i % 30}`, text: "KEKW" });
    msgs.sort((a, b) => a.t - b.t);
    const r = analyzeChat(msgs, 300);
    expect(r.signals.length).toBeGreaterThan(0);
    const s = r.signals[0];
    expect(s.time).toBeLessThan(160);
    expect((s.end ?? 0)).toBeGreaterThan(150);
    expect(["emote_spam", "chat_surge"]).toContain(s.kind);
  });
});

function feat(n: number): AudioFeatures {
  return { step: 0.5, rmsDb: new Array(n).fill(-40), centroid: new Array(n).fill(1000), hiRatio: new Array(n).fill(0.1), flatness: new Array(n).fill(0.1), modulation: new Array(n).fill(0.1) };
}

describe("audio events", () => {
  it("flags excited speech only when brighter AND louder than baseline", () => {
    const f = feat(240);
    for (let i = 100; i < 110; i++) {
      f.rmsDb[i] = -22;
      f.centroid[i] = 2200;
      f.hiRatio[i] = 0.4;
    }
    const a = detectAudioEvents(f);
    expect(a.signals.some((s) => s.kind === "excited_speech" && s.time >= 49 && s.time <= 51)).toBe(true);
  });
  it("does not call plain loudness (no spectral change) excited speech", () => {
    const f = feat(240);
    for (let i = 100; i < 110; i++) f.rmsDb[i] = -22; // louder only
    const a = detectAudioEvents(f);
    expect(a.signals.some((s) => s.kind === "excited_speech")).toBe(false);
  });
  it("detects laughter-like modulation", () => {
    const f = feat(240);
    for (let i = 60; i < 68; i++) {
      f.modulation[i] = 0.9;
      f.rmsDb[i] = -28;
      f.hiRatio[i] = 0.15;
    }
    expect(detectAudioEvents(f).signals.some((s) => s.kind === "laughter")).toBe(true);
  });
});

const cfg: AnalysisConfig = {
  keywords: [],
  categoryOverride: "auto",
  minDuration: 15,
  maxDuration: 60,
  targetDuration: 30,
  maxClips: 5,
  adaptive: true,
  weights: DEFAULT_SETTINGS.weights,
  language: "",
  useChat: true,
  useVision: false,
  retranscribe: false,
  replaceExisting: true,
};

function input(signals: Signal[], extra: Partial<ScoringInput> = {}): ScoringInput {
  const segments: Cue[] = [];
  for (let t = 0; t < 600; t += 6) segments.push({ start: t, end: t + 5, text: `line ${t}` });
  return {
    duration: 600,
    signals,
    segments,
    silences: [],
    speech: new Array(600).fill(1),
    available: { audio: true, visual: true, semantic: true, chat: true, game: true, keyword: false },
    category: "gaming",
    config: cfg,
    llmHighlights: [],
    ...extra,
  };
}

describe("highlight scoring & boundaries", () => {
  const multi: Signal[] = [
    { family: "audio", kind: "excited_speech", time: 300, end: 306, intensity: 0.9, label: "Shouting" },
    { family: "chat", kind: "chat_surge", time: 298, end: 308, intensity: 0.9, label: "Chat surge" },
    { family: "semantic", kind: "surprise", time: 301, end: 305, intensity: 0.8, label: "Surprise" },
  ];
  it("ranks multi-signal moments above loudness-only moments", () => {
    const loud: Signal[] = [{ family: "audio", kind: "volume_spike", time: 100, end: 102, intensity: 0.8, label: "spike" }];
    const r = proposeClips(input([...multi, ...loud]));
    expect(r.proposals.length).toBeGreaterThan(0);
    const top = r.proposals[0];
    expect(top.peak).toBeGreaterThan(295);
    expect(top.peak).toBeLessThan(312);
    expect(top.scores.loudnessOnly).toBe(false);
    const loudClip = r.proposals.find((p) => p.peak < 150);
    if (loudClip) {
      expect(loudClip.scores.loudnessOnly).toBe(true);
      expect(loudClip.score).toBeLessThan(top.score);
    }
  });
  it("keeps clips within duration limits and inside the media", () => {
    const r = proposeClips(input(multi));
    for (const p of r.proposals) {
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.end).toBeLessThanOrEqual(600);
      expect(p.end - p.start).toBeGreaterThanOrEqual(14.5);
      expect(p.end - p.start).toBeLessThanOrEqual(60.5);
      expect(p.start).toBeLessThanOrEqual(p.peak);
      expect(p.end).toBeGreaterThanOrEqual(p.peak);
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.reason.length).toBeGreaterThan(10);
      expect(p.confidence).toBeGreaterThan(0);
    }
  });
  it("snaps boundaries to transcript segments", () => {
    const p = proposeClips(input(multi)).proposals[0];
    const starts = new Set(input([]).segments.map((s) => s.start));
    expect(starts.has(p.start)).toBe(true);
  });
  it("keyword hits always surface a clip", () => {
    const segs: Cue[] = [{ start: 200, end: 205, text: "bruce wayne" }];
    const kw = findKeywordMatches(segs, ["bruce wayne"]);
    const r = proposeClips(input(kw, { segments: segs, available: { audio: true, visual: false, semantic: true, chat: false, game: false, keyword: true }, config: { ...cfg, keywords: ["bruce wayne"] } }));
    expect(r.proposals.some((p) => p.start <= 200 && p.end >= 205)).toBe(true);
  });
  it("keeps a keyword moment that overlaps a stronger clip by trimming instead of dropping it", () => {
    const segs: Cue[] = [];
    for (let t = 0; t < 300; t += 6) segs.push({ start: t, end: t + 5, text: t === 120 ? "bruce wayne" : `line ${t}` });
    const kw = findKeywordMatches(segs, ["bruce wayne"]);
    const strong: Signal[] = [
      { family: "audio", kind: "excited_speech", time: 100, end: 108, intensity: 1, label: "Shouting" },
      { family: "chat", kind: "chat_surge", time: 96, end: 112, intensity: 1, label: "Chat surge" },
      { family: "semantic", kind: "surprise", time: 100, end: 106, intensity: 1, label: "Surprise" },
    ];
    const r = proposeClips(input([...strong, ...kw], { segments: segs, available: { audio: true, visual: false, semantic: true, chat: true, game: false, keyword: true }, config: { ...cfg, keywords: ["bruce wayne"] } }));
    const k = r.proposals.find((p) => p.evidence.some((e) => e.family === "keyword"));
    expect(k).toBeDefined();
    expect(k!.start).toBeLessThanOrEqual(120);
    expect(k!.end).toBeGreaterThanOrEqual(125);
    for (const a of r.proposals) for (const b of r.proposals) if (a !== b) expect(Math.min(a.end, b.end) - Math.max(a.start, b.start)).toBeLessThanOrEqual(0.01);
  });
  it("honours user weights and builds a bounded timeline", () => {
    const i = input(multi);
    const { timeline } = buildTimeline(i);
    expect(timeline.combined).toHaveLength(600);
    expect(Math.max(...timeline.combined)).toBeLessThanOrEqual(1);
    const none = buildTimeline({ ...i, config: { ...cfg, weights: { audio: 0, visual: 0, semantic: 0, chat: 0, game: 0, keyword: 0 } } });
    expect(Math.max(...none.timeline.combined)).toBe(0);
  });
  it("regenerates longer/shorter boundaries", () => {
    const i = input(multi);
    const base = { start: 290, end: 320, peak: 303 };
    const longer = regenerateBoundaries(i, base, "longer");
    const shorter = regenerateBoundaries(i, base, "shorter");
    expect(longer.end - longer.start).toBeGreaterThan(shorter.end - shorter.start);
  });
});

function fakeClip(over: Partial<ClipRow> = {}): ClipRow {
  return {
    id: 1, projectId: 1, mediaId: 1, analysisId: null, title: "T", startSec: 10, endSec: 40, peakSec: 20, score: 80, confidence: 0.8,
    category: "gaming", reason: "", evidence: [], scores: null, status: "approved", rank: 1, source: "ai", aspect: "9:16",
    crop: DEFAULT_CROP, audio: DEFAULT_AUDIO, subtitles: { enabled: true, cues: [{ start: 12, end: 15, text: "Hi {there}" }], style: DEFAULT_SUBTITLE_STYLE },
    thumbPath: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}
const fakeMedia = { id: 1, hasVideo: true, hasAudio: true } as MediaRow;

describe("export planning", () => {
  it("builds a vertical crop command with correct seek/duration", () => {
    const plan = planRender({ clip: fakeClip(), media: fakeMedia, source: "in.mp4", settings: DEFAULT_EXPORT, encoderName: "libx264", out: "out.mp4", assName: "subs.ass" });
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(plan.args).toContain("-ss");
    expect(plan.args[plan.args.indexOf("-ss") + 1]).toBe("10.000");
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("30.000");
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("ass=subs.ass");
    expect(fc).toContain("scale=1080:1920");
    expect(plan.args).toContain("libx264");
  });
  it("applies audio options", () => {
    const plan = planRender({ clip: fakeClip({ audio: { volume: 1.5, mute: false, fadeIn: 1, fadeOut: 2, normalize: true } }), media: fakeMedia, source: "in.mp4", settings: DEFAULT_EXPORT, encoderName: "libx264", out: "o.mp4" });
    const af = plan.args[plan.args.indexOf("-af") + 1];
    expect(af).toContain("loudnorm");
    expect(af).toContain("volume=1.500");
    expect(af).toContain("afade=t=out:st=28.00");
    const muted = planRender({ clip: fakeClip({ audio: { ...DEFAULT_AUDIO, mute: true } }), media: fakeMedia, source: "in.mp4", settings: DEFAULT_EXPORT, encoderName: "libx264", out: "o.mp4" });
    expect(muted.args).toContain("-an");
  });
  it("rejects empty clips and builds ASS with escaped text", () => {
    expect(() => planRender({ clip: fakeClip({ startSec: 5, endSec: 5 }), media: fakeMedia, source: "x", settings: DEFAULT_EXPORT, encoderName: "libx264", out: "o" })).toThrow();
    const ass = buildAss([{ start: 2, end: 4, text: "Hi {there}\nfriend" }], { ...DEFAULT_SUBTITLE_STYLE, bgOpacity: 0.5 }, 1080, 1920);
    expect(ass).toContain("Dialogue: 1,0:00:02.00,0:00:04.00,Text,,0,0,0,,Hi (there)\\Nfriend");
    expect(ass).toContain("Dialogue: 0,"); // background box layer
    expect(ass).toContain("PlayResX: 1080");
  });
});

describe("security & providers", () => {
  it("sanitizes file names", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename('a<b>:"c|d?*.mp4')).toBe("a_b___c_d__.mp4");
    expect(sanitizeFilename("CON")).toBe("file");
    expect(sanitizeFilename("   ...  ")).toBe("file");
  });
  it("encrypts secrets at rest", () => {
    const enc = encryptSecret("sk-test-123456");
    expect(enc).not.toContain("sk-test");
    expect(decryptSecret(enc)).toBe("sk-test-123456");
    expect(decryptSecret("v1:bad:bad:bad")).toBeNull();
  });
  it("blocks private URLs (SSRF)", async () => {
    await expect(assertPublicUrl(new URL("http://127.0.0.1/x.mp4"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://192.168.1.5/x.mp4"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("ftp://example.com/x"))).rejects.toThrow();
  });
  it("gates cloud providers behind the privacy setting", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
    expect(() => assertCloudAllowed("https://api.openai.com/v1", DEFAULT_SETTINGS, "the audio track")).toThrow(AIError);
    expect(() => assertCloudAllowed("http://localhost:11434/v1", DEFAULT_SETTINGS, "x")).not.toThrow();
    const allowed = { ...DEFAULT_SETTINGS, privacy: { ...DEFAULT_SETTINGS.privacy, allowCloud: true } };
    expect(() => assertCloudAllowed("https://api.openai.com/v1", allowed, "x")).not.toThrow();
  });
  it("extracts JSON from noisy model output", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('text {"highlights":[]} trailing')).toEqual({ highlights: [] });
    expect(extractJson("no json")).toBeNull();
  });
});
