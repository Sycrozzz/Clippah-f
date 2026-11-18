import type {
  AnalysisConfig,
  Category,
  ClipScores,
  Cue,
  Evidence,
  Signal,
  SignalFamily,
  Timeline,
  Weights,
} from "@/lib/shared/types";
import { CATEGORIES } from "@/lib/shared/types";
import { clamp, fmtTime } from "@/lib/shared/time";
import type { LLMHighlight } from "./semantic";

const FAMILIES: SignalFamily[] = ["audio", "visual", "semantic", "chat", "game", "keyword"];

const BASE_WEIGHTS: Record<Category, Weights> = {
  gaming: { audio: 0.25, visual: 0.2, semantic: 0.1, chat: 0.2, game: 0.15, keyword: 0.1 },
  comedy: { audio: 0.25, visual: 0.05, semantic: 0.35, chat: 0.15, game: 0, keyword: 0.1 },
  podcast: { audio: 0.1, visual: 0.05, semantic: 0.55, chat: 0.1, game: 0, keyword: 0.2 },
  reaction: { audio: 0.3, visual: 0.15, semantic: 0.25, chat: 0.15, game: 0, keyword: 0.1 },
  irl: { audio: 0.25, visual: 0.2, semantic: 0.25, chat: 0.2, game: 0, keyword: 0.1 },
  drama: { audio: 0.2, visual: 0.05, semantic: 0.45, chat: 0.2, game: 0, keyword: 0.1 },
  sports: { audio: 0.35, visual: 0.25, semantic: 0.1, chat: 0.15, game: 0.1, keyword: 0.05 },
  storytelling: { audio: 0.1, visual: 0.05, semantic: 0.6, chat: 0.05, game: 0, keyword: 0.2 },
  general: { audio: 0.25, visual: 0.15, semantic: 0.3, chat: 0.15, game: 0.05, keyword: 0.1 },
};

/** [lead-in before peak, tail after peak] in seconds — setup matters more for jokes/stories. */
const LEAD: Record<Category, [number, number]> = {
  gaming: [8, 6],
  comedy: [12, 5],
  podcast: [14, 8],
  reaction: [8, 6],
  irl: [10, 6],
  drama: [12, 8],
  sports: [8, 6],
  storytelling: [20, 8],
  general: [10, 6],
};

export interface ScoringInput {
  duration: number;
  signals: Signal[];
  segments: Cue[];
  silences: number[];
  speech: number[];
  available: Record<SignalFamily, boolean>;
  category: Category;
  config: AnalysisConfig;
  llmHighlights: LLMHighlight[];
}

export interface ClipProposal {
  start: number;
  end: number;
  peak: number;
  score: number;
  confidence: number;
  category: Category;
  title: string;
  reason: string;
  evidence: Evidence[];
  scores: ClipScores;
}

function paint(signals: Signal[], n: number, family: SignalFamily): number[] {
  const tl = new Array<number>(n).fill(0);
  for (const s of signals) {
    if (s.family !== family) continue;
    const a = Math.max(0, Math.floor(s.time));
    const b = Math.min(n, Math.max(a + 1, Math.ceil(s.end ?? s.time + 1)));
    for (let i = a; i < b; i++) tl[i] = Math.max(tl[i], s.intensity);
    // reactions bleed slightly around events
    const spread = family === "chat" || family === "audio" ? 2 : 1;
    for (let k = 1; k <= spread; k++) {
      const f = s.intensity * (1 - k * 0.3);
      if (a - k >= 0) tl[a - k] = Math.max(tl[a - k], f);
      if (b - 1 + k < n) tl[b - 1 + k] = Math.max(tl[b - 1 + k], f);
    }
  }
  return tl;
}

function movingAvg(a: number[], radius: number): number[] {
  return a.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(a.length - 1, i + radius); k++) {
      s += a[k];
      c++;
    }
    return s / c;
  });
}

export function effectiveWeights(category: Category, user: Weights, available: Record<SignalFamily, boolean>, hasKeywords: boolean): Weights {
  const base = { ...BASE_WEIGHTS[category] };
  if (hasKeywords) base.keyword = 0.35;
  const w = {} as Weights;
  for (const f of FAMILIES) w[f] = available[f] ? base[f] * clamp(user[f] ?? 1, 0, 3) : 0;
  return w;
}

export function buildTimeline(input: ScoringInput, motion: number[] = []): { timeline: Timeline; fam: Record<SignalFamily, number[]> } {
  const n = Math.max(1, Math.ceil(input.duration));
  const fam = {} as Record<SignalFamily, number[]>;
  for (const f of FAMILIES) fam[f] = paint(input.signals, n, f);
  const w = effectiveWeights(input.category, input.config.weights, input.available, input.config.keywords.length > 0);
  const wsum = FAMILIES.reduce((a, f) => a + w[f], 0) || 1;
  const raw = new Array<number>(n).fill(0);
  const active = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of FAMILIES) s += w[f] * fam[f][i];
    raw[i] = s / wsum;
    let cnt = 0;
    for (const f of FAMILIES) {
      if (!w[f]) continue;
      let m = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) m = Math.max(m, fam[f][k]);
      if (m > 0.3) cnt++;
    }
    active[i] = cnt;
  }
  const combined = raw.map((r, i) => {
    const sat = 1 - Math.exp(-2.4 * r);
    const agree = clamp(0.75 + 0.15 * Math.min(3, active[i]), 0, 1.2);
    let v = clamp(sat * agree, 0, 1);
    if (fam.keyword[i] > 0) v = Math.max(v, 0.7);
    return v;
  });
  const timeline: Timeline = {
    step: 1,
    duration: input.duration,
    audio: fam.audio.map((v) => +v.toFixed(3)),
    motion: (motion.length ? motion : fam.visual).slice(0, n).map((v) => +v.toFixed(3)),
    semantic: fam.semantic.map((v) => +v.toFixed(3)),
    chat: fam.chat.map((v) => +v.toFixed(3)),
    keyword: fam.keyword.map((v) => +v.toFixed(3)),
    game: fam.game.map((v) => +v.toFixed(3)),
    speech: input.speech.slice(0, n),
    combined: combined.map((v) => +v.toFixed(3)),
  };
  return { timeline, fam };
}

/* ------------------------- boundary detection ------------------------- */

function snapStart(t: number, segs: Cue[], silences: number[]): { t: number; snapped: boolean } {
  let best: Cue | null = null;
  for (const s of segs) {
    if (s.start <= t + 0.01) best = s;
    else break;
  }
  if (best && t - best.start <= 9 && best.end > t - 0.5) return { t: best.start, snapped: true };
  const next = segs.find((s) => s.start > t && s.start - t <= 3);
  if (next) return { t: next.start, snapped: true };
  const sil = silences.filter((x) => Math.abs(x - t) <= 4).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  if (sil !== undefined) return { t: sil, snapped: true };
  return { t, snapped: false };
}

function snapEnd(t: number, segs: Cue[], silences: number[]): { t: number; snapped: boolean } {
  const containing = segs.find((s) => s.start <= t && s.end >= t);
  if (containing && containing.end - t <= 8) return { t: containing.end + 0.3, snapped: true };
  let prev: Cue | null = null;
  for (const s of segs) {
    if (s.end <= t + 0.01) prev = s;
    else break;
  }
  if (prev && t - prev.end <= 4) return { t: prev.end + 0.3, snapped: true };
  const sil = silences.filter((x) => Math.abs(x - t) <= 4).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  if (sil !== undefined) return { t: sil, snapped: true };
  return { t, snapped: false };
}

export interface BoundaryOptions {
  peak: number;
  peakValue: number;
  sm: number[];
  duration: number;
  segs: Cue[];
  silences: number[];
  category: Category;
  minDuration: number;
  maxDuration: number;
  targetDuration: number;
  adaptive: boolean;
  range?: { start: number; end: number };
}

export function findBoundaries(o: BoundaryOptions): { start: number; end: number; startSnapped: boolean; endSnapped: boolean } {
  const [lead, tail] = LEAD[o.category];
  const total = o.duration;
  const minD = Math.min(o.minDuration, total);
  const maxD = Math.max(minD, Math.min(o.maxDuration, total));
  let s: number;
  let e: number;
  if (o.range) {
    s = o.range.start;
    e = o.range.end;
  } else if (o.adaptive) {
    s = o.peak - lead;
    e = o.peak + tail;
    const thr = o.peakValue * 0.55;
    let ext = 0;
    while (e < total && e - s < maxD && ext < 40 && (o.sm[Math.min(o.sm.length - 1, Math.floor(e))] ?? 0) >= thr) {
      e += 1;
      ext++;
    }
    ext = 0;
    while (s > 0 && e - s < maxD && ext < lead * 0.5 && (o.sm[Math.max(0, Math.floor(s))] ?? 0) >= thr) {
      s -= 1;
      ext++;
    }
  } else {
    s = o.peak - o.targetDuration * 0.45;
    e = s + o.targetDuration;
  }
  s = clamp(s, 0, total);
  e = clamp(e, 0, total);
  const ss = snapStart(s, o.segs, o.silences);
  const se = snapEnd(e, o.segs, o.silences);
  s = ss.t;
  e = se.t;
  // enforce duration limits around the peak
  if (e - s < minD) {
    const need = minD - (e - s);
    e = Math.min(total, e + need * 0.6);
    s = Math.max(0, s - (minD - (e - s)));
    e = Math.min(total, Math.max(e, s + minD));
  }
  if (e - s > maxD) {
    const keepBefore = Math.min(lead, maxD * 0.6);
    s = Math.max(s, o.peak - keepBefore);
    if (e - s > maxD) e = s + maxD;
  }
  s = clamp(s, 0, total);
  e = clamp(e, s + 1, total);
  return { start: +s.toFixed(2), end: +e.toFixed(2), startSnapped: ss.snapped, endSnapped: se.snapped };
}

/* ------------------------------ proposals ------------------------------ */

function overlapRatio(a: [number, number], b: [number, number]): number {
  const o = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  return o <= 0 ? 0 : o / Math.min(a[1] - a[0], b[1] - b[0]);
}

export function proposeClips(input: ScoringInput): { proposals: ClipProposal[]; timeline: Timeline; weak: boolean } {
  const { timeline, fam } = buildTimeline(input);
  const n = timeline.combined.length;
  const sm = movingAvg(timeline.combined, 1);
  const mean = sm.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(sm.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let thr = Math.max(0.28, mean + std);
  const sortedSm = [...sm].sort((a, b) => a - b);
  const median = sortedSm[Math.floor(n / 2)] ?? 0;
  const peaks: number[] = [];
  const findPeaks = (t: number) => {
    peaks.length = 0;
    for (let i = 0; i < n; i++) {
      if (sm[i] >= t && sm[i] >= (sm[i - 1] ?? 0) && sm[i] > (sm[i + 1] ?? -1)) peaks.push(i);
    }
  };
  findPeaks(thr);
  let weak = false;
  if (!peaks.length) {
    thr = Math.max(0.12, sortedSm[Math.floor(n * 0.95)] ?? 0.12);
    findPeaks(thr);
    weak = peaks.length > 0;
  }
  peaks.sort((a, b) => sm[b] - sm[a]);
  const minGap = Math.max(10, input.config.minDuration / 2);
  const chosen: number[] = [];
  for (const p of peaks) {
    if (chosen.every((c) => Math.abs(c - p) >= minGap)) chosen.push(p);
    if (chosen.length >= input.config.maxClips * 3) break;
  }

  const hasTranscript = input.segments.length > 0;
  const proposals: ClipProposal[] = [];
  for (const peak of chosen) {
    const llm = input.llmHighlights.find((h) => peak >= h.start - 2 && peak <= h.end + 2);
    const b = findBoundaries({
      peak,
      peakValue: sm[peak],
      sm,
      duration: input.duration,
      segs: input.segments,
      silences: input.silences,
      category: input.category,
      minDuration: input.config.minDuration,
      maxDuration: input.config.maxDuration,
      targetDuration: input.config.targetDuration,
      adaptive: input.config.adaptive,
      range: llm ? { start: llm.start, end: llm.end } : undefined,
    });
    const inClip = (i: number) => i >= Math.floor(b.start) && i < Math.ceil(b.end);
    const activeFams = FAMILIES.filter((f) => {
      if (!input.available[f]) return false;
      for (let i = Math.floor(b.start); i < Math.min(n, Math.ceil(b.end)); i++) if (fam[f][i] > 0.3) return true;
      return false;
    });
    const evSignals = input.signals
      .filter((s) => (s.end ?? s.time + 1) >= b.start - 2 && s.time <= b.end + 2 && s.kind !== "scene_change")
      .sort((a, c) => c.intensity - a.intensity);
    const seen = new Set<string>();
    const evidence: Evidence[] = [];
    for (const s of evSignals) {
      const key = `${s.kind}`;
      if (seen.has(key) && evidence.length >= 3) continue;
      seen.add(key);
      evidence.push({ family: s.family, kind: s.kind, time: +s.time.toFixed(1), label: s.label, strength: +s.intensity.toFixed(2) });
      if (evidence.length >= 8) break;
    }
    // Anti-loudness rule: audio-only, loudness-driven evidence is penalised and flagged.
    const audioEv = evSignals.filter((s) => s.family === "audio");
    const loudnessOnly = activeFams.length <= 1 && activeFams[0] === "audio" && audioEv.every((s) => s.kind === "volume_spike" || s.kind === "excited_speech");
    let peakVal = sm[peak];
    let meanVal = 0;
    let cnt = 0;
    for (let i = Math.floor(b.start); i < Math.min(n, Math.ceil(b.end)); i++) {
      meanVal += timeline.combined[i];
      cnt++;
    }
    meanVal /= Math.max(1, cnt);
    if (loudnessOnly) {
      peakVal *= 0.6;
      meanVal *= 0.6;
    }
    const availCount = FAMILIES.filter((f) => input.available[f]).length || 1;
    const score = Math.round(100 * clamp(0.65 * peakVal + 0.25 * meanVal + 0.1 * (activeFams.length / availCount), 0, 1));

    // ---- engagement estimate (NOT a viral-performance guarantee) ----
    const maxIn = (arr: number[]) => {
      let m = 0;
      for (let i = Math.floor(b.start); i < Math.min(n, Math.ceil(b.end)); i++) m = Math.max(m, arr[i]);
      return m;
    };
    const laugh = Math.max(0, ...evSignals.filter((s) => s.kind === "laughter" || s.kind === "applause").map((s) => s.intensity));
    const emotional = clamp(Math.max(maxIn(fam.audio), maxIn(fam.semantic) * 0.9), 0, 1);
    const entertainment = clamp(Math.max(maxIn(fam.chat), laugh, maxIn(fam.semantic) * 0.8, maxIn(fam.game) * 0.8), 0, 1);
    const context = clamp((b.startSnapped ? 0.5 : 0.15) + (b.endSnapped ? 0.5 : 0.15), 0, 1);
    const uniqueness = clamp((sm[peak] - median) / Math.max(0.2, 1 - median), 0, 1);
    let speechCov = 0;
    for (let i = Math.floor(b.start); i < Math.min(n, Math.ceil(b.end)); i++) speechCov += input.speech[i] ?? 0;
    speechCov /= Math.max(1, cnt);
    const narrative = llm ? clamp((llm.complete ? 0.55 : 0.25) + context * 0.3 + 0.15, 0, 1) : clamp(context * 0.6 + (b.end - b.start >= 15 ? 0.2 : 0) + (speechCov > 0.5 ? 0.2 : 0), 0, 1);
    const overall = Math.round(100 * (0.3 * emotional + 0.25 * entertainment + 0.15 * context + 0.15 * uniqueness + 0.15 * narrative));

    const confidence = clamp(0.3 + 0.14 * Math.min(4, activeFams.length) + (llm ? 0.12 : 0) + (hasTranscript ? 0.05 : 0) - (loudnessOnly ? 0.2 : 0) - (weak ? 0.1 : 0), 0.1, 0.95);

    const catLabel = CATEGORIES.find((c) => c.id === input.category)?.label ?? "Highlight";
    const kwHit = evSignals.find((s) => s.family === "keyword");
    const seg = input.segments.find((s) => s.start <= peak && s.end >= peak) ?? input.segments.find((s) => s.start >= peak);
    let title = llm?.title || "";
    if (!title && kwHit) title = kwHit.label.split(": ")[0].replace("Keyword ", "Moment: ");
    if (!title && seg) title = `“${seg.text.trim().split(/\s+/).slice(0, 8).join(" ")}${seg.text.trim().split(/\s+/).length > 8 ? "…" : ""}”`;
    if (!title) title = `${catLabel} moment at ${fmtTime(peak)}`;

    const top = evidence.slice(0, 3).map((e) => e.label.replace(/: “.*$/, "").replace(/ \(.*\)$/, ""));
    const reason =
      (llm?.reason ? `${llm.reason} ` : "") +
      `Detected from ${activeFams.length || 1} signal type${activeFams.length === 1 ? "" : "s"} (${activeFams.join(", ") || "audio"}): ${[...new Set(top)].join("; ") || "combined score peak"}.` +
      (loudnessOnly ? " Warning: supported by loudness only — treat with caution." : "");

    const families: ClipScores["families"] = {};
    for (const f of FAMILIES) if (input.available[f]) families[f] = +maxIn(fam[f]).toFixed(2);

    proposals.push({
      start: b.start,
      end: b.end,
      peak,
      score,
      confidence: +confidence.toFixed(2),
      category: input.category,
      title,
      reason,
      evidence,
      scores: { families, engagement: { emotional: Math.round(emotional * 100), entertainment: Math.round(entertainment * 100), context: Math.round(context * 100), uniqueness: Math.round(uniqueness * 100), narrative: Math.round(narrative * 100), overall }, loudnessOnly },
    });
    void inClip;
  }

  // de-duplicate overlapping proposals, keeping the strongest
  proposals.sort((a, b) => b.score - a.score);
  // Overlaps are resolved by trimming the weaker clip away from the stronger one (so a distinct
  // moment such as a keyword hit isn't lost), and dropping it only if its peak lies inside a stronger clip.
  const final: ClipProposal[] = [];
  for (const p of proposals) {
    const cand = { ...p };
    let drop = false;
    for (const f of final) {
      if (overlapRatio([f.start, f.end], [cand.start, cand.end]) <= 0) continue;
      if (cand.peak >= f.end) cand.start = Math.max(cand.start, f.end);
      else if (cand.peak <= f.start) cand.end = Math.min(cand.end, f.start);
      else drop = true;
    }
    const hasKeyword = cand.evidence.some((e) => e.family === "keyword");
    const minKeep = hasKeyword ? 5 : Math.max(5, input.config.minDuration * 0.6);
    if (drop || cand.end - cand.start < minKeep || cand.peak < cand.start || cand.peak > cand.end) continue;
    cand.start = +cand.start.toFixed(2);
    cand.end = +cand.end.toFixed(2);
    final.push(cand);
    if (final.length >= input.config.maxClips) break;
  }
  void overlapRatio;
  return { proposals: final, timeline, weak };
}

/** Recompute boundaries for an existing clip (used by "regenerate"). */
export function regenerateBoundaries(
  input: ScoringInput,
  clip: { start: number; end: number; peak: number | null },
  mode: "resnap" | "longer" | "shorter",
): { start: number; end: number } {
  const { timeline } = buildTimeline(input);
  const sm = movingAvg(timeline.combined, 1);
  const peak = clip.peak ?? (clip.start + clip.end) / 2;
  const dur = clip.end - clip.start;
  const cfg = input.config;
  const target = mode === "longer" ? Math.min(cfg.maxDuration, dur * 1.4) : mode === "shorter" ? Math.max(cfg.minDuration, dur * 0.65) : cfg.targetDuration;
  const b = findBoundaries({
    peak,
    peakValue: sm[Math.min(sm.length - 1, Math.floor(peak))] ?? 0.5,
    sm,
    duration: input.duration,
    segs: input.segments,
    silences: input.silences,
    category: input.category,
    minDuration: mode === "shorter" ? Math.min(cfg.minDuration, target) : cfg.minDuration,
    maxDuration: mode === "longer" ? Math.max(cfg.maxDuration, target) : cfg.maxDuration,
    targetDuration: target,
    adaptive: mode === "resnap",
  });
  return { start: b.start, end: b.end };
}
