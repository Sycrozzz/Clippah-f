"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  code?: string;
  hint?: string;
  constructor(message: string, code?: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; hint?: string };
    throw new ApiError(d.error ?? `Request failed (${res.status})`, d.code, d.hint);
  }
  return data as T;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.hint && !e.message.includes(e.hint) && e.code !== "ffmpeg_failed" ? `${e.message} ${e.hint}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

export function useApi<T>(url: string | null, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(url);
  urlRef.current = url;
  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const r = await api<T>(u);
      if (urlRef.current === u) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    void load();
  }, [url, load]);
  useEffect(() => {
    if (!opts.interval) return;
    const t = setInterval(() => void load(), opts.interval);
    return () => clearInterval(t);
  }, [opts.interval, load]);
  return { data, error, loading, reload: load, setData };
}

/* ----- toasts ----- */
export type ToastKind = "info" | "success" | "error";
export function toast(message: string, kind: ToastKind = "info") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("clippahh-toast", { detail: { message, kind } }));
}

/* ----- shared response types ----- */
export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  mediaCount: number;
  clipCount: number;
  approvedCount: number;
  exportCount: number;
  thumbMediaId: number | null;
}

export interface MediaItem {
  id: number;
  projectId: number;
  originalName: string;
  sizeBytes: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  bitrate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  browserPlayable: boolean;
  hasProxy: boolean;
  hasThumb: boolean;
  chatCount: number;
  sourceType: string;
  createdAt: string;
  hasTranscript: boolean;
  transcriptSource: string | null;
  clipCount: number;
  analyzed: boolean;
}

export interface JobItem {
  id: number;
  type: string;
  projectId: number | null;
  projectName: string | null;
  mediaId: number | null;
  mediaName: string | null;
  clipId: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  etaSeconds: number | null;
  result: Record<string, unknown>;
  logs: { t: number; kind: string; msg: string }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ClipItem {
  id: number;
  projectId: number;
  mediaId: number;
  mediaName: string;
  title: string;
  startSec: number;
  endSec: number;
  score: number;
  confidence: number;
  category: string;
  reason: string;
  evidence: { family: string; kind: string; time: number; label: string; strength: number }[];
  scores: {
    families: Record<string, number>;
    engagement: { emotional: number; entertainment: number; context: number; uniqueness: number; narrative: number; overall: number };
    loudnessOnly: boolean;
    visualNote?: string;
  } | null;
  status: "pending" | "approved" | "rejected";
  rank: number;
  source: string;
  aspect: string;
  hasThumb: boolean;
  updatedAt: string;
}

export interface SystemInfo {
  hardware: {
    ffmpeg: { path: string; source: string; version: string } | null;
    ffprobe: boolean;
    encoders: { h264: string[]; hevc: string[]; vp9: string[]; av1: string[] };
    nvenc: boolean;
    gpuName: string | null;
    cpuCores: number;
    memGB: number;
    platform: string;
  };
  dataDir: string;
  diskFreeBytes: number;
  ytDlp: boolean;
  ai: {
    transcription: { ready: boolean; reason: string | null };
    semantic: { ready: boolean; reason: string | null };
    keys: Record<string, { set: boolean; masked: string }>;
    allowCloud: boolean;
  };
}
