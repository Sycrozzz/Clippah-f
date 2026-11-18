import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { detectHardware, getFfmpeg, isBrowserPlayable, pickEncoder, probe, runFFmpeg } from "@/lib/server/ffmpeg";
import { analyzeAudio, detectAudioEvents } from "@/lib/server/analysis/audio";
import { analyzeVisual, detectVisualEvents } from "@/lib/server/analysis/visual";
import { buildAss, planRender } from "@/lib/server/export";
import { DEFAULT_AUDIO, DEFAULT_CROP, DEFAULT_EXPORT, DEFAULT_SUBTITLE_STYLE } from "@/lib/shared/defaults";
import type { ClipRow } from "@/lib/server/clips";
import type { MediaRow } from "@/lib/server/media";
import { CancelledError } from "@/lib/server/errors";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clippahh-it-"));
const src = path.join(dir, "src.mp4");
const cuts = path.join(dir, "cuts.mp4");
const audioOnly = path.join(dir, "burst.wav");
const long = path.join(dir, "long.mp4");

function ff(args: string[]) {
  const r = spawnSync(getFfmpeg(), ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** gray 32x18 raw frame at time t (seconds) */
function frame(file: string, t: number): Buffer {
  const r = spawnSync(getFfmpeg(), ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1e6 });
  return r.stdout;
}
const mad = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

beforeAll(() => {
  // 60 s moving test pattern with 440 Hz tone
  ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=60", "-f", "lavfi", "-i", "sine=f=440:d=60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
  // 20 s: red 10 s then blue 10 s => one hard cut at 10 s
  ff(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=15:d=10", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=15:d=10", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", cuts]);
  // 30 s audio: quiet noise, loud noise burst 12–16 s, quiet again
  ff([
    "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.01:d=12:r=16000",
    "-f", "lavfi", "-i", "anoisesrc=c=white:a=0.6:d=4:r=16000",
    "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.01:d=14:r=16000",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1", audioOnly,
  ]);
  // ~10 minute long recording (low-res, ultrafast) for the long-video check
  ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=600", "-f", "lavfi", "-i", "sine=f=220:d=600:r=16000", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35", "-c:a", "aac", "-b:a", "32k", "-shortest", long]);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ffprobe & hardware", () => {
  it("extracts metadata", async () => {
    const i = await probe(src);
    expect(i.duration).toBeCloseTo(60, 0);
    expect(i.width).toBe(640);
    expect(i.height).toBe(360);
    expect(i.videoCodec).toBe("h264");
    expect(i.audioCodec).toBe("aac");
    expect(isBrowserPlayable(i)).toBe(true);
  });
  it("gives clear errors for corrupted and non-media files", async () => {
    const bad = path.join(dir, "bad.mp4");
    fs.writeFileSync(bad, Buffer.from("this is definitely not a video file"));
    await expect(probe(bad)).rejects.toThrow(/corrupted|could not be read|codec/i);
    await expect(probe(path.join(dir, "missing.mp4"))).rejects.toThrow(/does not exist/);
    const trunc = path.join(dir, "trunc.mp4");
    fs.writeFileSync(trunc, fs.readFileSync(src).subarray(0, 3000));
    await expect(probe(trunc)).rejects.toThrow();
  });
  it("detects hardware and falls back to a CPU encoder", async () => {
    const hw = await detectHardware(true);
    expect(hw.ffmpeg).not.toBeNull();
    expect(hw.encoders.h264).toContain("libx264");
    expect(pickEncoder("h264", hw, false).gpu).toBe(false);
  });
  it("supports cancelling a running FFmpeg process", async () => {
    const ctrl = new AbortController();
    const p = runFFmpeg(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=60:d=600", "-c:v", "libx264", "-f", "null", "-"], { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 500);
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("audio analysis", () => {
  it("measures the loudness burst at the right time (streamed PCM)", async () => {
    const f = await analyzeAudio(audioOnly, { duration: 30 });
    expect(f.rmsDb.length).toBeGreaterThanOrEqual(58);
    const at = (s: number) => f.rmsDb[Math.floor(s / 0.5)];
    expect(at(14)).toBeGreaterThan(at(5) + 20);
    expect(at(25)).toBeLessThan(at(14) - 20);
    const ev = detectAudioEvents(f);
    const burst = ev.signals.filter((s) => s.time >= 11 && s.time <= 17);
    expect(burst.length).toBeGreaterThan(0);
    expect(ev.silences.length).toBeGreaterThan(0);
  });
});

describe("visual analysis", () => {
  it("finds the hard scene cut at 10 s", async () => {
    const v = await analyzeVisual(cuts, { duration: 20 });
    expect(v.cuts.some((c) => Math.abs(c - 10) < 1)).toBe(true);
    const d = detectVisualEvents(v);
    expect(d.signals.some((s) => s.kind === "scene_change")).toBe(true);
  });
  it("analyses a 10-minute recording quickly with progress", async () => {
    const t0 = Date.now();
    const prog: number[] = [];
    const [a, v] = await Promise.all([
      analyzeAudio(long, { duration: 600, onProgress: (f) => prog.push(f) }),
      analyzeVisual(long, { duration: 600 }),
    ]);
    expect(a.rmsDb.length).toBeGreaterThan(1150);
    expect(v.motion.length).toBe(600);
    expect(prog.length).toBeGreaterThan(5);
    expect(Math.max(...prog)).toBeGreaterThan(0.95);
    expect(Date.now() - t0).toBeLessThan(90_000);
  });
});

function clip(over: Partial<ClipRow>): ClipRow {
  return {
    id: 1, projectId: 1, mediaId: 1, analysisId: null, title: "T", startSec: 20, endSec: 32, peakSec: 25, score: 80, confidence: 0.8,
    category: "gaming", reason: "", evidence: [], scores: null, status: "approved", rank: 1, source: "ai", aspect: "9:16",
    crop: DEFAULT_CROP, audio: DEFAULT_AUDIO, subtitles: { enabled: false, cues: [], style: DEFAULT_SUBTITLE_STYLE },
    thumbPath: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}
const media = { id: 1, hasVideo: true, hasAudio: true } as MediaRow;

describe("clip export (real FFmpeg)", () => {
  it("exports the correct time range with right size, duration and playable output", async () => {
    const out = path.join(dir, "clip.mp4");
    const c = clip({});
    const plan = planRender({ clip: c, media, source: src, settings: { ...DEFAULT_EXPORT, resolution: 540 }, encoderName: "libx264", out });
    await runFFmpeg(plan.args, { cwd: dir });
    const i = await probe(out);
    expect(i.duration).toBeCloseTo(12, 0);
    expect(i.width).toBe(540);
    expect(i.height).toBe(960);
    expect(i.audioCodec).toBe("aac");
    // content check: first frame of the clip must match the source at ~20 s, not at other times
    // (centre-crop to 9:16 of a 16:9 source: compare the same crop of the source)
    const ref = (t: number) => {
      const r = spawnSync(getFfmpeg(), ["-v", "error", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", "crop=w=trunc(min(iw\\,ih*0.5625)/2)*2:h=ih:x=(iw-ow)/2:y=0,scale=32:18,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1e6 });
      return r.stdout;
    };
    const got = frame(out, 0.5);
    const right = mad(got, ref(20.5));
    const wrong = mad(got, ref(35));
    expect(right).toBeLessThan(wrong);
  });

  it("supports 16:9, 1:1, 4:5 and custom aspect ratios", async () => {
    const cases: [string, number, number][] = [["16:9", 640, 360], ["1:1", 360, 360], ["4:5", 360, 450], ["21:9", 840, 360]];
    for (const [aspect, w, h] of cases) {
      const out = path.join(dir, `a-${aspect.replace(":", "x")}.mp4`);
      const plan = planRender({ clip: clip({ aspect, endSec: 24 }), media, source: src, settings: { ...DEFAULT_EXPORT, aspect: "clip", resolution: 360, fps: 24 }, encoderName: "libx264", out });
      await runFFmpeg(plan.args, { cwd: dir });
      const i = await probe(out);
      expect([i.width, i.height]).toEqual([w, h]);
    }
  });

  it("burns in synchronised subtitles and blur-fit layout", async () => {
    const tmp = fs.mkdtempSync(path.join(dir, "sub-"));
    const out = path.join(dir, "sub.mp4");
    const c = clip({ startSec: 10, endSec: 20, crop: { ...DEFAULT_CROP, mode: "blur" }, subtitles: { enabled: true, style: { ...DEFAULT_SUBTITLE_STYLE, bgOpacity: 0.6 }, cues: [{ start: 12, end: 16, text: "Hello Clippahh" }] } });
    const plan0 = planRender({ clip: c, media, source: src, settings: { ...DEFAULT_EXPORT, resolution: 540 }, encoderName: "libx264", out });
    fs.writeFileSync(path.join(tmp, "subs.ass"), buildAss([{ start: 2, end: 6, text: "Hello Clippahh" }], c.subtitles.style, plan0.width, plan0.height));
    const plan = planRender({ clip: c, media, source: src, settings: { ...DEFAULT_EXPORT, resolution: 540 }, encoderName: "libx264", out, assName: "subs.ass" });
    await runFFmpeg(plan.args, { cwd: tmp });
    const plain = path.join(dir, "plain.mp4");
    await runFFmpeg(planRender({ clip: c, media, source: src, settings: { ...DEFAULT_EXPORT, resolution: 540 }, encoderName: "libx264", out: plain }).args, { cwd: tmp });
    // with subtitles visible (t=4 inside cue 2–6) the frame differs from the plain render; outside the cue (t=8) it does not
    const grab = (f: string, t: number) => {
      const r = spawnSync(getFfmpeg(), ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "scale=108:192,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1e6 });
      return r.stdout;
    };
    const inside = mad(grab(out, 4), grab(plain, 4));
    const outside = mad(grab(out, 8), grab(plain, 8));
    expect(inside).toBeGreaterThan(outside + 0.3);
    expect((await probe(out)).duration).toBeCloseTo(10, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("exports audio-only media with a generated background", async () => {
    const out = path.join(dir, "audio-clip.mp4");
    const plan = planRender({ clip: clip({ startSec: 12, endSec: 16 }), media: { id: 2, hasVideo: false, hasAudio: true } as MediaRow, source: audioOnly, settings: { ...DEFAULT_EXPORT, resolution: 360 }, encoderName: "libx264", out });
    await runFFmpeg(plan.args, { cwd: dir });
    const i = await probe(out);
    expect(i.hasVideo).toBe(true);
    expect(i.duration).toBeCloseTo(4, 0);
  });

  it("exports VP9/WebM and applies mute", async () => {
    const out = path.join(dir, "v.webm");
    const hw = await detectHardware();
    if (!hw.encoders.vp9.length) return;
    const plan = planRender({ clip: clip({ startSec: 0, endSec: 3, audio: { ...DEFAULT_AUDIO, mute: true } }), media, source: src, settings: { ...DEFAULT_EXPORT, format: "webm", codec: "vp9", resolution: 360, videoBitrate: 1000 }, encoderName: "libvpx-vp9", out });
    await runFFmpeg(plan.args, { cwd: dir });
    const i = await probe(out);
    expect(i.videoCodec).toBe("vp9");
    expect(i.hasAudio).toBe(false);
  });
});
