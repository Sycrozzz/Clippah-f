import { spawn } from "node:child_process";
import type { Signal } from "@/lib/shared/types";
import { clamp } from "@/lib/shared/time";
import { getFfmpeg } from "../ffmpeg";
import { AppError, CancelledError } from "../errors";

export const AUDIO_STEP = 0.5; // seconds per analysis window
const SR = 16000;
const WIN = SR * AUDIO_STEP; // 8000 samples
const FFT = 512;
const FRAMES = Math.floor(WIN / FFT); // 15

export interface AudioFeatures {
  step: number;
  rmsDb: number[];
  centroid: number[];
  hiRatio: number[];
  flatness: number[];
  /** modulation strength in the 3–8 Hz syllable/laughter band (0..1) */
  modulation: number[];
}

/* ----- tiny radix-2 FFT ----- */
const hann = new Float64Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
const cosT = new Float64Array(FFT / 2).map((_, i) => Math.cos((2 * Math.PI * i) / FFT));
const sinT = new Float64Array(FFT / 2).map((_, i) => -Math.sin((2 * Math.PI * i) / FFT));
const rev = (() => {
  const r = new Uint16Array(FFT);
  const bits = Math.log2(FFT);
  for (let i = 0; i < FFT; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    r[i] = y;
  }
  return r;
})();

function fftMag(samples: Int16Array, offset: number, re: Float64Array, im: Float64Array, mag: Float64Array): void {
  for (let i = 0; i < FFT; i++) {
    re[rev[i]] = (samples[offset + i] / 32768) * hann[i];
    im[rev[i]] = 0;
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1;
    const stepT = FFT / size;
    for (let i = 0; i < FFT; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += stepT) {
        const a = i + j;
        const b = a + half;
        const tr = re[b] * cosT[k] - im[b] * sinT[k];
        const ti = re[b] * sinT[k] + im[b] * cosT[k];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let i = 0; i < FFT / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
}

/** Streams decoded PCM from FFmpeg (never loads the whole file in RAM). */
export function analyzeAudio(
  file: string,
  opts: { signal?: AbortSignal; onProgress?: (frac: number) => void; duration: number },
): Promise<AudioFeatures> {
  return new Promise((resolve, reject) => {
    const out: AudioFeatures = { step: AUDIO_STEP, rmsDb: [], centroid: [], hiRatio: [], flatness: [], modulation: [] };
    const frameEnergy: number[] = []; // 32 ms resolution, for modulation analysis
    const child = spawn(getFfmpeg(), ["-hide_banner", "-nostdin", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    opts.signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    let pending: Buffer = Buffer.alloc(0);
    let err = "";
    const re = new Float64Array(FFT);
    const im = new Float64Array(FFT);
    const mag = new Float64Array(FFT / 2);
    let samplesDone = 0;

    const processWindow = (buf: Buffer) => {
      const s = new Int16Array(buf.buffer, buf.byteOffset, WIN);
      let sum = 0;
      for (let i = 0; i < WIN; i++) sum += s[i] * s[i];
      const rms = Math.sqrt(sum / WIN) / 32768;
      out.rmsDb.push(20 * Math.log10(rms + 1e-7));
      let cen = 0;
      let hi = 0;
      let flat = 0;
      for (let f = 0; f < FRAMES; f++) {
        fftMag(s, f * FFT, re, im, mag);
        let tot = 0;
        let wsum = 0;
        let hiE = 0;
        let logSum = 0;
        let n = 0;
        let e2 = 0;
        for (let k = 1; k < FFT / 2; k++) {
          const m = mag[k];
          tot += m;
          wsum += m * k;
          e2 += m * m;
          if (k >= 64) hiE += m * m;
          if (k >= 4) {
            logSum += Math.log(m + 1e-9);
            n++;
          }
        }
        frameEnergy.push(e2);
        cen += tot > 0 ? (wsum / tot) * (SR / FFT) : 0;
        hi += e2 > 0 ? hiE / e2 : 0;
        const arith = tot / (FFT / 2 - 1);
        flat += arith > 1e-9 ? Math.exp(logSum / n) / arith : 0;
      }
      out.centroid.push(cen / FRAMES);
      out.hiRatio.push(hi / FRAMES);
      out.flatness.push(flat / FRAMES);
    };

    child.stdout.on("data", (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      const bytes = WIN * 2;
      while (pending.length >= bytes) {
        // copy to guarantee 2-byte alignment for Int16Array
        const chunk = Buffer.from(pending.subarray(0, bytes));
        pending = pending.subarray(bytes);
        processWindow(chunk);
        samplesDone += WIN;
        if (opts.duration > 0) opts.onProgress?.(clamp(samplesDone / SR / opts.duration, 0, 1));
      }
    });
    child.stderr.on("data", (d) => (err = (err + d).slice(-600)));
    child.on("error", (e) => reject(new AppError("ffmpeg_spawn", `Could not start FFmpeg: ${e.message}`)));
    child.on("close", (code) => {
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code !== 0 && out.rmsDb.length === 0) return reject(new AppError("audio_decode", `Audio could not be decoded. ${err.split("\n").pop() ?? ""}`));
      out.modulation = modulationFromEnergy(frameEnergy, out.rmsDb.length);
      resolve(out);
    });
  });
}

/** 3–8 Hz energy-envelope modulation (laughter / rapid speech has strong syllabic pulsing). */
export function modulationFromEnergy(frameEnergy: number[], windows: number): number[] {
  const fps = SR / FFT; // 31.25 frames/s
  const env = frameEnergy.map((e) => Math.log(e + 1e-9));
  const span = Math.round(1.5 * fps); // 1.5 s analysis span
  const freqs = [3, 4, 5, 6, 7, 8];
  const res: number[] = [];
  for (let w = 0; w < windows; w++) {
    const centre = Math.round(((w + 0.5) * AUDIO_STEP) * fps);
    const a = Math.max(0, centre - span / 2);
    const b = Math.min(env.length, a + span);
    const n = b - a;
    if (n < span * 0.6) {
      res.push(0);
      continue;
    }
    let mean = 0;
    for (let i = a; i < b; i++) mean += env[i];
    mean /= n;
    let best = 0;
    let varSum = 0;
    for (let i = a; i < b; i++) varSum += (env[i] - mean) ** 2;
    const sd = Math.sqrt(varSum / n) + 1e-6;
    for (const f of freqs) {
      let cr = 0;
      let ci = 0;
      for (let i = 0; i < n; i++) {
        const ph = (2 * Math.PI * f * i) / fps;
        const v = env[a + i] - mean;
        cr += v * Math.cos(ph);
        ci += v * Math.sin(ph);
      }
      best = Math.max(best, (2 * Math.hypot(cr, ci)) / n / sd);
    }
    res.push(clamp(best, 0, 1));
  }
  return res;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function median(arr: number[]): number {
  return percentile(arr, 50);
}

/** Rolling-median loudness baseline, so “loud” is relative to the speaker/stream's normal level. */
export function loudnessBaseline(rmsDb: number[], spanSec = 120): number[] {
  const half = Math.round(spanSec / AUDIO_STEP / 2);
  const stride = 8;
  const pts: { i: number; v: number }[] = [];
  for (let i = 0; i < rmsDb.length; i += stride) {
    const win = rmsDb.slice(Math.max(0, i - half), Math.min(rmsDb.length, i + half)).filter((v) => v > -70);
    pts.push({ i, v: win.length ? median(win) : -60 });
  }
  const out = new Array<number>(rmsDb.length).fill(-60);
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1] ?? a;
    for (let i = a.i; i < (k + 1 < pts.length ? b.i : rmsDb.length); i++) {
      const t = b.i === a.i ? 0 : (i - a.i) / (b.i - a.i);
      out[i] = a.v + (b.v - a.v) * t;
    }
  }
  return out;
}

export interface AudioAnalysis {
  signals: Signal[];
  /** per-window 0..1 intensity of non-trivial audio events */
  intensity: number[];
  /** times (s) where audio is near-silent: good cut points */
  silences: number[];
  /** speech-like activity ratio per window */
  speechActive: boolean[];
  stats: { floorDb: number; medianDb: number; laughterRatio: number; speechRatio: number };
}

function runs(flags: boolean[], minLen: number): [number, number][] {
  const r: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      if (i - s >= minLen) r.push([s, i]);
      s = -1;
    }
  }
  return r;
}

export function detectAudioEvents(f: AudioFeatures): AudioAnalysis {
  const n = f.rmsDb.length;
  const signals: Signal[] = [];
  const intensity = new Array<number>(n).fill(0);
  if (n === 0) return { signals, intensity, silences: [], speechActive: [], stats: { floorDb: -60, medianDb: -60, laughterRatio: 0, speechRatio: 0 } };

  const voiced = f.rmsDb.filter((v) => v > -70);
  const floorDb = percentile(voiced.length ? voiced : f.rmsDb, 10);
  const medianDb = median(voiced.length ? voiced : f.rmsDb);
  const base = loudnessBaseline(f.rmsDb);
  const medCen = median(f.centroid);
  const medHi = median(f.hiRatio);
  const flatP85 = percentile(f.flatness, 85);
  const modP75 = percentile(f.modulation, 75);
  const t = (i: number) => i * AUDIO_STEP;

  const speechActive = f.rmsDb.map((db) => db > floorDb + 8);
  const lift = f.rmsDb.map((db, i) => db - base[i]);

  // 1) Excited / shouting speech: loud relative to baseline AND spectrally brighter (not just louder).
  const exc = lift.map((l, i) => l > 5 && f.hiRatio[i] > medHi * 1.1 && f.centroid[i] > medCen * 1.05 && f.rmsDb[i] > floorDb + 12);
  for (const [a, b] of runs(exc, 2)) {
    const peak = Math.max(...lift.slice(a, b));
    const inten = clamp((peak - 4) / 14, 0.15, 1);
    signals.push({ family: "audio", kind: "excited_speech", time: t(a), end: t(b), intensity: inten, label: `Shouting / excited speech (+${peak.toFixed(0)} dB over normal)` });
    for (let i = a; i < b; i++) intensity[i] = Math.max(intensity[i], inten);
  }

  // 2) Laughter: strong 3–8 Hz pulsing, voiced level, sustained.
  const laugh = f.modulation.map((m, i) => m > Math.max(0.5, modP75) && f.rmsDb[i] > floorDb + 10 && f.hiRatio[i] > medHi * 0.8 && f.flatness[i] <= flatP85);
  let laughWins = 0;
  for (const [a, b] of runs(laugh, 3)) {
    const inten = clamp(Math.max(...f.modulation.slice(a, b)) * 0.9, 0.3, 0.9);
    signals.push({ family: "audio", kind: "laughter", time: t(a), end: t(b), intensity: inten, label: "Probable laughter (rhythmic voiced bursts)" });
    for (let i = a; i < b; i++) intensity[i] = Math.max(intensity[i], inten);
    laughWins += b - a;
  }

  // 3) Applause / crowd: broadband, noise-like, sustained, above baseline.
  const app = f.flatness.map((fl, i) => fl > Math.max(flatP85, 0.2) && lift[i] > 2 && f.modulation[i] < modP75);
  for (const [a, b] of runs(app, 5)) {
    const inten = clamp(0.35 + (Math.max(...lift.slice(a, b)) - 2) / 16, 0.3, 0.85);
    signals.push({ family: "audio", kind: "applause", time: t(a), end: t(b), intensity: inten, label: "Probable applause / crowd noise (broadband sustained)" });
    for (let i = a; i < b; i++) intensity[i] = Math.max(intensity[i], inten);
  }

  // 4) Sudden volume change (loudness-only evidence; scoring penalises it when uncorroborated).
  for (let i = 4; i < n; i++) {
    const prev = (f.rmsDb[i - 1] + f.rmsDb[i - 2] + f.rmsDb[i - 3] + f.rmsDb[i - 4]) / 4;
    const jump = f.rmsDb[i] - prev;
    if (jump > 10 && f.rmsDb[i] > floorDb + 15) {
      const inten = clamp((jump - 8) / 16, 0.15, 0.8) * 0.7;
      signals.push({ family: "audio", kind: "volume_spike", time: t(i), end: t(i + 2), intensity: inten, label: `Sudden volume change (+${jump.toFixed(0)} dB)` });
      for (let k = i; k < Math.min(n, i + 2); k++) intensity[k] = Math.max(intensity[k], inten);
      i += 3;
    }
  }

  // Silences (cut points): consecutive near-silent windows ≥ 0.8 s
  const quiet = f.rmsDb.map((db) => db < floorDb + 4);
  const silences = runs(quiet, 2).map(([a, b]) => t((a + b) / 2));

  const speechRatio = speechActive.filter(Boolean).length / n;
  return { signals, intensity, silences, speechActive, stats: { floorDb, medianDb, laughterRatio: laughWins / n, speechRatio } };
}
