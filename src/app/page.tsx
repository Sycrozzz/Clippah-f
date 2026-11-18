"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Empty, Icon, Modal, Notice, PageHeader, Field, inputCls, statusTone } from "@/components/ui";
import JobCard from "@/components/JobCard";
import { api, errMsg, useApi, type ClipItem, type JobItem, type ProjectRow, type SystemInfo } from "@/lib/client/api";
import { fmtDuration, fmtTime } from "@/lib/shared/time";

export default function Dashboard() {
  const router = useRouter();
  const { data: p } = useApi<{ projects: ProjectRow[] }>("/api/projects", { interval: 8000 });
  const { data: j, reload: reloadJ } = useApi<{ jobs: JobItem[] }>("/api/jobs?limit=6", { interval: 3000 });
  const { data: c } = useApi<{ clips: ClipItem[] }>("/api/clips?sort=recent&limit=6", { interval: 10000 });
  const { data: sys } = useApi<SystemInfo>("/api/system");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const projects = p?.projects ?? [];
  const totals = projects.reduce((a, x) => ({ media: a.media + x.mediaCount, clips: a.clips + x.clipCount, approved: a.approved + x.approvedCount, exp: a.exp + x.exportCount }), { media: 0, clips: 0, approved: 0, exp: 0 });

  const create = async () => {
    try {
      const r = await api<{ project: { id: number } }>("/api/projects", { method: "POST", json: { name } });
      router.push(`/import?project=${r.project.id}`);
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Turn long recordings into short clips worth posting.">
        <Link href="/import">
          <Button>
            <Icon name="upload" /> Import media
          </Button>
        </Link>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Icon name="plus" /> New project
        </Button>
      </PageHeader>

      {sys && (!sys.ai.transcription.ready || !sys.ai.semantic.ready) && (
        <div className="mb-6">
          <Notice>
            <p className="font-medium">Finish setting up AI providers for the best results</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted">
              {!sys.ai.transcription.ready && <li>Speech recognition: {sys.ai.transcription.reason}</li>}
              {!sys.ai.semantic.ready && <li>Semantic AI: {sys.ai.semantic.reason}</li>}
            </ul>
            <p className="mt-1 text-xs text-muted">
              Audio and visual analysis work without any provider.{" "}
              <Link href="/settings" className="text-accent hover:underline">
                Open settings
              </Link>
            </p>
          </Notice>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Projects", projects.length, "folder"],
          ["Media files", totals.media, "film"],
          ["Clips · approved", `${totals.clips} · ${totals.approved}`, "star"],
          ["Exports", totals.exp, "download"],
        ].map(([label, v, icon]) => (
          <Card key={label as string} className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-accent/15 p-2.5 text-accent">
              <Icon name={icon as string} className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold">{v}</div>
              <div className="text-xs text-muted">{label}</div>
            </div>
          </Card>
        ))}
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent projects</h2>
          <Link href="/projects" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </div>
        {projects.length === 0 ? (
          <Empty icon="folder" title="No projects yet">
            Create a project, import a recording and let Clippahh find the best moments.
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 6).map((pr) => (
              <Link key={pr.id} href={`/projects/${pr.id}`} className="group overflow-hidden rounded-xl border border-line bg-panel transition hover:border-accent/50">
                <div className="aspect-[16/6] bg-panel2">
                  {pr.thumbMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${pr.thumbMediaId}/thumb`} alt="" className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <Icon name="film" className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="truncate text-sm font-medium">{pr.name}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {pr.mediaCount} media · {pr.clipCount} clips · {pr.approvedCount} approved
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recent processing activity</h2>
          {(j?.jobs ?? []).length === 0 ? (
            <Empty icon="clock" title="No activity yet" />
          ) : (
            <div className="space-y-3">
              {j!.jobs.map((job) => (
                <JobCard key={job.id} job={job} compact onChange={reloadJ} />
              ))}
            </div>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recent clips</h2>
          {(c?.clips ?? []).length === 0 ? (
            <Empty icon="star" title="No clips yet">
              Analyze a video to generate ranked highlights.
            </Empty>
          ) : (
            <div className="space-y-2">
              {c!.clips.map((clip) => (
                <Link key={clip.id} href={`/editor/${clip.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2 transition hover:border-accent/50">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black">
                    {clip.hasThumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/clips/${clip.id}/thumb`} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{clip.title}</p>
                    <p className="text-xs text-muted">
                      {fmtTime(clip.startSec)} · {fmtDuration(clip.endSec - clip.startSec)} · score {Math.round(clip.score)}
                    </p>
                  </div>
                  <Badge tone={statusTone(clip.status)}>{clip.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <div className="space-y-4">
          <Field label="Project name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} placeholder="Friday stream highlights" />
          </Field>
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={create}>
              Create & import
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
