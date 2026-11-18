import type { ExportSettings } from "./types";
import { DEFAULT_EXPORT } from "./defaults";

export interface ExportPreset {
  id: string;
  label: string;
  description: string;
  recommendedMaxSec?: number;
  settings: Partial<ExportSettings>;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    description: "9:16, 1080×1920, 30 fps, H.264",
    recommendedMaxSec: 180,
    settings: { aspect: "9:16", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 10000, audioBitrate: 192 },
  },
  {
    id: "tiktok",
    label: "TikTok",
    description: "9:16, 1080×1920, 30 fps, H.264",
    recommendedMaxSec: 180,
    settings: { aspect: "9:16", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 8000, audioBitrate: 192 },
  },
  {
    id: "instagram-reels",
    label: "Instagram Reels",
    description: "9:16, 1080×1920, 30 fps, H.264",
    recommendedMaxSec: 90,
    settings: { aspect: "9:16", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 8000, audioBitrate: 192 },
  },
  {
    id: "youtube",
    label: "YouTube (standard)",
    description: "16:9, 1920×1080, 30 fps, H.264",
    settings: { aspect: "16:9", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 12000, audioBitrate: 256 },
  },
  {
    id: "square",
    label: "Square 1:1",
    description: "1:1, 1080×1080, 30 fps, H.264",
    settings: { aspect: "1:1", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 8000, audioBitrate: 192 },
  },
  {
    id: "portrait",
    label: "Portrait 4:5",
    description: "4:5, 1080×1350, 30 fps, H.264",
    settings: { aspect: "4:5", resolution: 1080, fps: 30, codec: "h264", format: "mp4", videoBitrate: 8000, audioBitrate: 192 },
  },
  { id: "custom", label: "Custom", description: "Choose every setting yourself", settings: {} },
];

export function applyPreset(base: ExportSettings, presetId: string): ExportSettings {
  const p = EXPORT_PRESETS.find((x) => x.id === presetId);
  return { ...DEFAULT_EXPORT, ...base, ...(p?.settings ?? {}), preset: presetId };
}

export const ASPECT_OPTIONS = ["9:16", "16:9", "1:1", "4:5"];

export function parseAspect(s: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/i.exec(s);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!w || !h || w / h > 10 || h / w > 10) return null;
  return w / h;
}

/** Output pixel size for an aspect ratio and short-edge resolution (even numbers). */
export function outputSize(aspect: number, shortEdge: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (aspect <= 1) return { width: even(shortEdge), height: even(shortEdge / aspect) };
  return { width: even(shortEdge * aspect), height: even(shortEdge) };
}
