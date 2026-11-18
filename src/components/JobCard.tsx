"use client";
import Link from "next/link";
import { Badge, Button, Icon, Progress, statusTone } from "./ui";
import { api, toast, errMsg, type JobItem } from "@/lib/client/api";

export function fmtEta(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "";
  if (s < 60) return `~${Math.max(1, Math.round(s))}s left`;
  if (s < 3600) return `~${Math.floor(s / 60)}m ${Math.round(s % 60)}s left`;
  return `~${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m left`;
}

const TYPE_LABEL: Record<string, string> = { analysis: "AI analysis", export: "Export", proxy: "Preview proxy", download: "Download" };

export default function JobCard({ job, onChange, compact }: { job: JobItem; onChange: () => void; compact?: boolean }) {
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const live = job.status === "running" || job.status === "queued";
  const events = job.logs.filter((l) => l.kind === "event").slice(-6).reverse();
  const warns = job.logs.filter((l) => l.kind === "warn");
  const result = job.result as { clips?: number; category?: string; warnings?: string[]; semanticMode?: string; transcriptSource?: string };

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(job.status)}>{job.status}</Badge>
            <span className="text-xs text-muted">{TYPE_LABEL[job.type] ?? job.type}</span>
            <span className="text-xs text-muted">· #{job.id}</span>
          </div>
          <h4 className="mt-1 truncate text-sm font-medium">{job.mediaName ?? job.projectName ?? "—"}</h4>
          {job.projectName && job.mediaName && <p className="text-xs text-muted">{job.projectName}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {live && (
            <Button size="sm" variant="danger" onClick={() => act(() => api(`/api/jobs/${job.id}`, { method: "DELETE" }))}>
              <Icon name="x" className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <Button size="sm" onClick={() => act(() => api(`/api/jobs/${job.id}`, { method: "POST", json: { action: "retry" } }))}>
              <Icon name="refresh" className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
          {job.status === "completed" && job.type === "analysis" && job.mediaId && (
            <Link href={`/highlights?media=${job.mediaId}`}>
              <Button size="sm" variant="primary">
                <Icon name="star" className="h-3.5 w-3.5" /> Review {result.clips ?? 0} clips
              </Button>
            </Link>
          )}
        </div>
      </div>

      {live && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium">{job.status === "queued" ? "Waiting in queue…" : job.stage}</span>
            <span className="text-muted">
              {job.status === "running" ? `${Math.round(job.progress * 100)}% ${fmtEta(job.etaSeconds)}` : ""}
            </span>
          </div>
          <Progress value={job.progress} indeterminate={job.status === "queued"} />
          {job.message && <p className="mt-1 truncate text-xs text-muted">{job.message}</p>}
        </div>
      )}

      {job.status === "failed" && job.error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{job.error}</p>}
      {job.status === "completed" && job.type === "analysis" && (
        <p className="mt-2 text-xs text-muted">
          {result.clips ?? 0} clips · category: {result.category ?? "—"} · text analysis: {result.semanticMode ?? "—"} · transcript: {result.transcriptSource ?? "—"}
        </p>
      )}

      {!compact && events.length > 0 && (
        <div className="mt-3 rounded-lg bg-bg p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Detected events</p>
          <ul className="space-y-1 font-mono text-xs">
            {events.map((e, i) => (
              <li key={i} className="truncate text-fg/90">
                {e.msg}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!compact && warns.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warns.slice(-4).map((w, i) => (
            <li key={i} className="flex gap-2 text-xs text-amber-300">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w.msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
