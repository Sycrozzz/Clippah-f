"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Icon, Modal, ScoreRing, Spinner, statusTone } from "./ui";
import { api, errMsg, toast, type ClipItem } from "@/lib/client/api";
import { fmtDuration, fmtTime } from "@/lib/shared/time";
import { CATEGORIES } from "@/lib/shared/types";

export const catLabel = (c: string) => CATEGORIES.find((x) => x.id === c)?.label ?? c;

export function PreviewModal({ clipId, title, onClose }: { clipId: number; title: string; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  return (
    <Modal open onClose={onClose} title={`Preview · ${title}`}>
      <div className="flex flex-col items-center gap-3">
        {state === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Rendering preview with your crop, subtitles and audio settings…
          </p>
        )}
        {state === "error" && <p className="text-sm text-rose-400">{msg}</p>}
        <video
          src={`/api/clips/${clipId}/preview`}
          controls
          autoPlay
          className={`max-h-[65vh] rounded-lg bg-black ${state === "ready" ? "" : "h-0"}`}
          onCanPlay={() => setState("ready")}
          onError={async () => {
            try {
              const r = await fetch(`/api/clips/${clipId}/preview`);
              const j = await r.json().catch(() => ({}));
              setMsg(j.error ?? "Preview could not be rendered.");
            } catch (e) {
              setMsg(errMsg(e));
            }
            setState("error");
          }}
        />
      </div>
    </Modal>
  );
}

export default function ClipCard({ clip, onChange }: { clip: ClipItem; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const dur = clip.endSec - clip.startSec;
  const eng = clip.scores?.engagement;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, "success");
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (status: string) => run(() => api(`/api/clips/${clip.id}`, { method: "PATCH", json: { status } }));
  const rename = () => {
    const t = prompt("Rename clip", clip.title);
    if (t && t.trim()) void run(() => api(`/api/clips/${clip.id}`, { method: "PATCH", json: { title: t } }));
  };

  return (
    <div className={`group flex flex-col overflow-hidden rounded-xl border bg-panel transition ${clip.status === "approved" ? "border-emerald-500/40" : clip.status === "rejected" ? "border-line opacity-60" : "border-line hover:border-accent/50"}`}>
      <div className="relative aspect-video bg-black">
        {clip.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/clips/${clip.id}/thumb?v=${encodeURIComponent(clip.updatedAt)}`} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Icon name="film" className="h-8 w-8" />
          </div>
        )}
        <button onClick={() => setPreview(true)} className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100" aria-label="Preview clip">
          <span className="rounded-full bg-accent p-3">
            <Icon name="play" className="h-5 w-5" />
          </span>
        </button>
        <div className="absolute left-2 top-2">
          <ScoreRing score={Math.round(clip.score)} />
        </div>
        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">{fmtDuration(dur)}</span>
        <div className="absolute right-2 top-2 flex gap-1">
          <Badge tone={statusTone(clip.status)}>{clip.status}</Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 text-sm font-medium leading-snug" title={clip.title}>
            {clip.title}
          </h4>
          <button onClick={rename} className="shrink-0 text-muted hover:text-fg" aria-label="Rename clip">
            <Icon name="edit" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge tone="accent">{catLabel(clip.category)}</Badge>
          <span className="font-mono">
            {fmtTime(clip.startSec)}–{fmtTime(clip.endSec)}
          </span>
          {clip.source !== "ai" && <Badge>{clip.source}</Badge>}
          {clip.scores?.loudnessOnly && <Badge tone="amber" title="Supported by loudness only">loudness only</Badge>}
        </div>
        <p className="line-clamp-2 text-xs text-muted">{clip.reason}</p>
        <button onClick={() => setOpen((o) => !o)} className="self-start text-xs text-accent hover:underline">
          {open ? "Hide details" : `Why this clip? · ${Math.round(clip.confidence * 100)}% confidence`}
        </button>
        {open && (
          <div className="space-y-2 rounded-lg bg-bg p-2.5 text-xs">
            <ul className="space-y-1">
              {clip.evidence.slice(0, 6).map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono text-muted">{fmtTime(e.time)}</span>
                  <span className="text-fg/90">{e.label}</span>
                </li>
              ))}
            </ul>
            {eng && (
              <div>
                <p className="mb-1 font-medium">Engagement estimate · {eng.overall}/100</p>
                <div className="grid grid-cols-5 gap-1 text-center">
                  {(["emotional", "entertainment", "context", "uniqueness", "narrative"] as const).map((k) => (
                    <div key={k} className="rounded bg-panel2 py-1">
                      <div className="font-semibold">{eng[k]}</div>
                      <div className="text-[9px] uppercase text-muted">{k.slice(0, 5)}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted">An estimate from detected signals — not a prediction or guarantee of audience performance.</p>
              </div>
            )}
            {clip.scores?.visualNote && <p className="text-muted">Vision: {clip.scores.visualNote}</p>}
          </div>
        )}

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button size="sm" variant={clip.status === "approved" ? "success" : "default"} disabled={busy} onClick={() => setStatus(clip.status === "approved" ? "pending" : "approved")} title="Approve">
            <Icon name="check" className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant={clip.status === "rejected" ? "danger" : "default"} disabled={busy} onClick={() => setStatus(clip.status === "rejected" ? "pending" : "rejected")} title="Reject">
            <Icon name="x" className="h-3.5 w-3.5" />
          </Button>
          <Link href={`/editor/${clip.id}`} className="flex-1">
            <Button size="sm" variant="primary" className="w-full">
              <Icon name="scissors" className="h-3.5 w-3.5" /> Edit
            </Button>
          </Link>
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setMenu((m) => !m)} aria-label="More">
              ···
            </Button>
            {menu && (
              <div className="absolute bottom-full right-0 z-20 mb-1 w-48 rounded-lg border border-line bg-panel2 p-1 text-xs shadow-xl" onMouseLeave={() => setMenu(false)}>
                {[
                  ["Preview render", () => setPreview(true)],
                  ["Duplicate", () => run(() => api(`/api/clips/${clip.id}/actions`, { method: "POST", json: { action: "duplicate" } }), "Clip duplicated")],
                  ["Regenerate · re-snap boundaries", () => run(() => api(`/api/clips/${clip.id}/actions`, { method: "POST", json: { action: "regenerate", mode: "resnap" } }), "Boundaries regenerated")],
                  ["Regenerate · longer", () => run(() => api(`/api/clips/${clip.id}/actions`, { method: "POST", json: { action: "regenerate", mode: "longer" } }), "Clip extended")],
                  ["Regenerate · shorter", () => run(() => api(`/api/clips/${clip.id}/actions`, { method: "POST", json: { action: "regenerate", mode: "shorter" } }), "Clip shortened")],
                  ["Delete", () => confirm("Delete this clip?") && run(() => api(`/api/clips/${clip.id}`, { method: "DELETE" }))],
                ].map(([label, fn]) => (
                  <button
                    key={label as string}
                    className={`block w-full rounded px-2 py-1.5 text-left hover:bg-line ${label === "Delete" ? "text-rose-400" : ""}`}
                    onClick={() => {
                      setMenu(false);
                      (fn as () => void)();
                    }}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {preview && <PreviewModal clipId={clip.id} title={clip.title} onClose={() => setPreview(false)} />}
    </div>
  );
}
