"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Button, Icon, Modal } from "./ui";
import { api, errMsg, toast, type MediaItem } from "@/lib/client/api";
import { fmtBytes, fmtTime } from "@/lib/shared/time";

export default function MediaCard({ m, onChange, onAnalyze }: { m: MediaItem; onChange: () => void; onAnalyze: (m: MediaItem) => void }) {
  const srtRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const attach = async (kind: "srt" | "chat", file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      if (kind === "srt") {
        await api(`/api/media/${m.id}/transcript`, { method: "POST", json: { srt: text } });
        toast("Subtitles imported as transcript", "success");
      } else {
        const r = await api<{ count: number }>(`/api/media/${m.id}/chat`, { method: "POST", json: { content: text } });
        toast(`Chat log attached (${r.count.toLocaleString()} messages)`, "success");
      }
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove “${m.originalName}” and its clips from Clippahh?${m.sourceType === "path" ? "\n(The original file on disk is not deleted.)" : "\nThe imported copy will be deleted."}`)) return;
    try {
      await api(`/api/media/${m.id}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <div className="flex gap-4 rounded-xl border border-line bg-panel p-3">
      <button onClick={() => setPreview(true)} className="relative h-24 w-40 shrink-0 overflow-hidden rounded-lg bg-black" aria-label="Preview">
        {m.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${m.id}/thumb`} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Icon name={m.hasVideo ? "film" : "mic"} className="h-8 w-8" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 text-[11px] font-medium text-white">{fmtTime(m.duration)}</span>
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition hover:bg-black/40 hover:opacity-100">
          <Icon name="play" className="h-7 w-7" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="truncate text-sm font-medium" title={m.originalName}>
            {m.originalName}
          </h4>
          <button onClick={remove} className="text-muted hover:text-rose-400" aria-label="Remove media">
            <Icon name="trash" />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {m.hasVideo ? `${m.width}×${m.height} · ${m.fps ? m.fps.toFixed(m.fps % 1 ? 2 : 0) + " fps · " : ""}` : "Audio · "}
          {(m.videoCodec ?? "").toUpperCase()}
          {m.videoCodec && m.audioCodec ? " + " : ""}
          {(m.audioCodec ?? "").toUpperCase()} · {(m.container ?? "").split(",")[0].toUpperCase()} · {fmtBytes(m.sizeBytes)}
          {m.bitrate ? ` · ${(m.bitrate / 1e6).toFixed(1)} Mb/s` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.analyzed ? <Badge tone="green">{m.clipCount} clips</Badge> : <Badge>Not analyzed</Badge>}
          {m.hasTranscript ? <Badge tone="cyan">Transcript · {m.transcriptSource}</Badge> : <Badge title="Attach an .srt or configure speech recognition">No transcript</Badge>}
          {m.chatCount > 0 && <Badge tone="accent">Chat · {m.chatCount.toLocaleString()}</Badge>}
          {!m.browserPlayable && m.hasVideo && <Badge tone={m.hasProxy ? "default" : "amber"}>{m.hasProxy ? "Preview proxy ready" : "Preparing preview proxy…"}</Badge>}
          {m.sourceType === "recording" && <Badge>Recording</Badge>}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => onAnalyze(m)}>
            <Icon name="sparkles" className="h-3.5 w-3.5" /> Analyze
          </Button>
          {m.clipCount > 0 && (
            <Link href={`/highlights?media=${m.id}`}>
              <Button size="sm">
                <Icon name="star" className="h-3.5 w-3.5" /> Clips
              </Button>
            </Link>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => srtRef.current?.click()}>
            Attach .srt
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => chatRef.current?.click()} title="Twitch/Kick chat export (JSON, CSV or text with timestamps)">
            Attach chat log
          </Button>
          <input ref={srtRef} type="file" accept=".srt" hidden onChange={(e) => attach("srt", e.target.files?.[0])} />
          <input ref={chatRef} type="file" accept=".json,.csv,.txt,.log" hidden onChange={(e) => attach("chat", e.target.files?.[0])} />
        </div>
      </div>
      <Modal open={preview} onClose={() => setPreview(false)} title={m.originalName} wide>
        {!m.browserPlayable && !m.hasProxy ? (
          <p className="text-sm text-muted">This format can’t be played in the browser directly. A preview proxy is being created in the background — check back shortly.</p>
        ) : (
          <video src={`/api/media/${m.id}/stream`} controls autoPlay className="max-h-[60vh] w-full rounded-lg bg-black" />
        )}
      </Modal>
    </div>
  );
}
