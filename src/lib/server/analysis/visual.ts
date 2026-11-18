import type { Signal } from "@/lib/shared/types";
import { clamp } from "@/lib/shared/time";
import { runFFmpeg } from "../ffmpeg";

export interface VisualFeatures {
  step: number; // seconds
  motion: number[]; // mean scene-difference score per second (0..1)
  cuts: number[]; // times of hard scene changes
}

/**
 * Samples the video at 2 fps (low-res) and records FFmpeg's per-frame scene-change score.
 * High scores = hard cuts; sustained medium scores = fast on-screen action.
 */
export async function analyzeVisual(
  file: string,
  opts: { duration: number; signal?: AbortSignal; onProgress?: (f: number) => void },
): Promise<VisualFeatures> {
  const n = Math.max(1, Math.ceil(opts.duration));
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  const cuts: number[] = [];
  let buf = "";
  let curT = 0;
  const onStdout = (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const pt = /pts_time:([\d.]+)/.exec(line);
      if (pt) curT = parseFloat(pt[1]);
      const sc = /lavfi\.scene_score=([\d.]+)/.exec(line);
      if (sc) {
        const v = parseFloat(sc[1]);
        const i = Math.min(n - 1, Math.floor(curT));
        sum[i] += v;
        cnt[i]++;
        if (v >= 0.3 && (!cuts.length || curT - cuts[cuts.length - 1] > 1.5)) cuts.push(curT);
      }
    }
  };
  await runFFmpeg(
    [
      "-i", file,
      "-an",
      "-vf", "fps=2,scale=160:-2,select=gte(scene\\,0),metadata=print:key=lavfi.scene_score:file=-",
      "-f", "null", "-",
    ],
    { signal: opts.signal, onStdout, onProgress: (t) => opts.onProgress?.(clamp(t / opts.duration, 0, 1)) },
  );
  const motion = sum.map((s, i) => (cnt[i] ? clamp(s / cnt[i], 0, 1) : 0));
  return { step: 1, motion, cuts };
}

export function detectVisualEvents(v: VisualFeatures): { signals: Signal[]; intensity: number[]; stats: { cutsPerMin: number; meanMotion: number } } {
  const n = v.motion.length;
  const sorted = [...v.motion].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(n * 0.9)] ?? 0;
  const mean = v.motion.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const signals: Signal[] = [];
  const intensity = new Array<number>(n).fill(0);
  // smoothed motion over 3 s to find action bursts
  const sm = v.motion.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) {
      s += v.motion[k];
      c++;
    }
    return s / c;
  });
  let i = 0;
  while (i < n) {
    if (sm[i] >= Math.max(p90, 0.08) && sm[i] > mean * 1.8) {
      let j = i;
      let peak = 0;
      while (j < n && sm[j] >= Math.max(p90 * 0.7, 0.06)) peak = Math.max(peak, sm[j++]);
      if (j - i >= 2) {
        const inten = clamp(peak / Math.max(0.35, p90 * 2), 0.2, 0.9);
        signals.push({ family: "visual", kind: "motion_burst", time: i, end: j, intensity: inten, label: "High on-screen activity (fast motion / action)" });
        for (let k = i; k < j; k++) intensity[k] = Math.max(intensity[k], inten);
      }
      i = j + 1;
    } else i++;
  }
  for (const c of v.cuts) {
    const idx = Math.min(n - 1, Math.floor(c));
    // isolated cuts are weak signals; they matter mostly as clip boundary hints
    signals.push({ family: "visual", kind: "scene_change", time: c, intensity: 0.25, label: "Scene change" });
    intensity[idx] = Math.max(intensity[idx], 0.25);
  }
  return { signals, intensity, stats: { cutsPerMin: (v.cuts.length / Math.max(1, n)) * 60, meanMotion: mean } };
}
