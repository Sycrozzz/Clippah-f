"use client";
import Link from "next/link";
import { use, useState } from "react";
import { Button, Empty, Icon, PageHeader, Card } from "@/components/ui";
import MediaCard from "@/components/MediaCard";
import AnalyzeDialog from "@/components/AnalyzeDialog";
import ClipCard from "@/components/ClipCard";
import JobCard from "@/components/JobCard";
import { api, errMsg, toast, useApi, type ClipItem, type JobItem, type MediaItem } from "@/lib/client/api";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: pd, error, reload: reloadP } = useApi<{ project: { id: number; name: string; description: string } }>(`/api/projects/${id}`);
  const { data: md, reload: reloadM } = useApi<{ media: MediaItem[] }>(`/api/media?projectId=${id}`, { interval: 5000 });
  const { data: cd, reload: reloadC } = useApi<{ clips: ClipItem[] }>(`/api/clips?projectId=${id}&sort=score`, { interval: 8000 });
  const { data: jd, reload: reloadJ } = useApi<{ jobs: JobItem[] }>(`/api/jobs?projectId=${id}&limit=12`, { interval: 3000 });
  const [target, setTarget] = useState<MediaItem | null>(null);

  if (error) return <Empty icon="alert" title="Project not found">{error}</Empty>;
  if (!pd) return null;
  const clips = cd?.clips ?? [];
  const approved = clips.filter((c) => c.status === "approved");

  const rename = async () => {
    const n = prompt("Rename project", pd.project.name);
    if (!n?.trim()) return;
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", json: { name: n } });
      void reloadP();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const exportAll = async () => {
    try {
      await api("/api/exports", { method: "POST", json: { projectId: +id } });
      toast("Export of all approved clips queued", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <>
      <PageHeader title={pd.project.name} subtitle={`${md?.media.length ?? 0} media · ${clips.length} clips · ${approved.length} approved`}>
        <Button onClick={rename}>
          <Icon name="edit" /> Rename
        </Button>
        <Link href={`/import?project=${id}`}>
          <Button>
            <Icon name="upload" /> Add media
          </Button>
        </Link>
        <Button variant="primary" onClick={exportAll} disabled={approved.length === 0} title="Exports every approved clip using your default export settings">
          <Icon name="download" /> Export project ({approved.length})
        </Button>
      </PageHeader>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Media</h2>
        {(md?.media ?? []).length === 0 ? (
          <Empty icon="film" title="No media in this project" />
        ) : (
          <div className="space-y-3">
            {md!.media.map((m) => (
              <MediaCard key={m.id} m={m} onChange={() => { void reloadM(); void reloadC(); }} onAnalyze={setTarget} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Clips</h2>
          <Link href={`/highlights?project=${id}`} className="text-xs text-accent hover:underline">
            Open in Highlights
          </Link>
        </div>
        {clips.length === 0 ? (
          <Empty icon="star" title="No clips yet">Analyze media to generate highlights.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {clips.slice(0, 9).map((c) => (
              <ClipCard key={c.id} clip={c} onChange={reloadC} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Processing history</h2>
        {(jd?.jobs ?? []).length === 0 ? (
          <Card className="p-4 text-sm text-muted">No processing yet.</Card>
        ) : (
          <div className="space-y-3">
            {jd!.jobs.map((j) => (
              <JobCard key={j.id} job={j} onChange={reloadJ} compact />
            ))}
          </div>
        )}
      </section>
      {target && <AnalyzeDialog media={target} onClose={() => setTarget(null)} />}
    </>
  );
}
