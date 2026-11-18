import type { Cue } from "./types";

export function fmtTime(sec: number, decimals = 0): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const sStr = decimals > 0 ? s.toFixed(decimals).padStart(3 + decimals - 1, "0") : String(Math.floor(s)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sStr}` : `${m}:${sStr}`;
}

export function parseTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  return fmtTime(sec);
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function srtStamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function formatSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtStamp(c.start)} --> ${srtStamp(c.end)}\n${c.text.trim()}\n`)
      .join("\n") 
  );
}

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, "").replace(/^\uFEFF/, "").split(/\n{2,}/);
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim().length);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx < 0) continue;
    const m = re.exec(lines[idx])!;
    const ms = (v: string) => parseInt(v.padEnd(3, "0").slice(0, 3), 10);
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + ms(m[4]) / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + ms(m[8]) / 1000;
    const body = lines
      .slice(idx + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
