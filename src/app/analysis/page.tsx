"use client";
import { useState } from "react";
import { Empty, PageHeader, Icon, Button } from "@/components/ui";
import JobCard from "@/components/JobCard";
import AnalyzeDialog from "@/components/AnalyzeDialog";
import { useApi, type JobItem, type MediaItem } from "@/lib/client/api";
import { fmtTime } from "@/lib/shared/time";

export default function AnalysisPage() {
  const { data, reload } = useApi<{ jobs: JobItem[] }>("/api/jobs?limit=60", { interval: 1500 });
  const { data: md } = useApi<{ media: MediaItem[] }>("/api/media", { interval: 6000 });
  const [target, setTarget] = useState<MediaItem | null>(null);
  const jobs = data?.jobs ?? [];
  const live = jobs.filter((j) => j.status === "running" || j.status === "queued").sort((a, b) => a.id - b.id);
  const done = jobs.filter((j) => !(j.status === "running" || j.status === "queued"));
  const pending = (md?.media ?? []).filter((m) => !m.analyzed && !live.some((j) => j.mediaId === m.id));

  return (
    <>
      <PageHeader title="AI Analysis" subtitle="Live progress for analysis, exports and background tasks. Interrupted jobs resume automatically after a restart." />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Active & queued</h2>
        {live.length === 0 ? (
          <Empty icon="sparkles" title="Nothing is processing">
            Start an analysis from a media file below or from Import Media.
          </Empty>
        ) : (
          <div className="space-y-3">
            {live.map((j) => (
              <JobCard key={j.id} job={j} onChange={reload} />
            ))}
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Ready to analyze</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {pending.slice(0, 8).map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.originalName}</p>
                  <p className="text-xs text-muted">{fmtTime(m.duration)} · {m.hasTranscript ? "transcript attached" : "no transcript"}</p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setTarget(m)}>
                  <Icon name="sparkles" className="h-3.5 w-3.5" /> Analyze
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        {done.length === 0 ? (
          <p className="text-sm text-muted">No finished jobs yet.</p>
        ) : (
          <div className="space-y-3">
            {done.map((j) => (
              <JobCard key={j.id} job={j} onChange={reload} compact={j.type !== "analysis"} />
            ))}
          </div>
        )}
      </section>
      {target && <AnalyzeDialog media={target} onClose={() => setTarget(null)} />}
    </>
  );
}
