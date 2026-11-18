"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Empty, Icon, PageHeader, inputCls } from "@/components/ui";
import ClipCard from "@/components/ClipCard";
import { api, errMsg, toast, useApi, type ClipItem, type MediaItem, type ProjectRow } from "@/lib/client/api";

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const project = sp.get("project") ?? "";
  const mediaId = sp.get("media") ?? "";
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("score");
  const qs = new URLSearchParams();
  if (project) qs.set("projectId", project);
  if (mediaId) qs.set("mediaId", mediaId);
  if (status) qs.set("status", status);
  qs.set("sort", sort);
  const { data, reload, loading } = useApi<{ clips: ClipItem[] }>(`/api/clips?${qs}`, { interval: 6000 });
  const { data: pd } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const { data: md } = useApi<{ media: MediaItem[] }>("/api/media");
  const clips = data?.clips ?? [];
  const counts = useMemo(() => ({ approved: clips.filter((c) => c.status === "approved").length, pending: clips.filter((c) => c.status === "pending").length }), [clips]);

  const setQ = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === "project") n.delete("media");
    router.replace(`/highlights?${n}`);
  };

  const bulk = async (from: string, to: string, minScore = 0) => {
    const targets = clips.filter((c) => c.status === from && c.score >= minScore);
    try {
      await Promise.all(targets.map((c) => api(`/api/clips/${c.id}`, { method: "PATCH", json: { status: to } })));
      toast(`${targets.length} clips ${to}`, "success");
      void reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <>
      <PageHeader title="Generated Highlights" subtitle="Ranked by AI highlight score. Review, approve or reject, then fine-tune in the editor.">
        <Link href={`/exports${project ? `?project=${project}` : ""}`}>
          <Button variant="primary" disabled={counts.approved === 0}>
            <Icon name="download" /> Export approved ({counts.approved})
          </Button>
        </Link>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select className={`${inputCls} !w-auto`} value={project} onChange={(e) => setQ("project", e.target.value)}>
          <option value="">All projects</option>
          {pd?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={`${inputCls} !w-auto`} value={mediaId} onChange={(e) => setQ("media", e.target.value)}>
          <option value="">All media</option>
          {md?.media.filter((m) => !project || m.projectId === +project).map((m) => (
            <option key={m.id} value={m.id}>
              {m.originalName}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-line p-0.5">
          {[["", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"]].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)} className={`rounded-md px-3 py-1 text-xs ${status === v ? "bg-accent text-white" : "text-muted hover:text-fg"}`}>
              {l}
            </button>
          ))}
        </div>
        <select className={`${inputCls} !w-auto`} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Sort: AI score</option>
          <option value="time">Sort: timeline order</option>
          <option value="recent">Sort: recently edited</option>
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => bulk("pending", "approved", 70)} disabled={!counts.pending} title="Approve all pending clips scoring 70+">
            Approve 70+
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk("pending", "rejected", 0)} disabled={!counts.pending}>
            Reject pending
          </Button>
        </div>
      </div>

      {!loading && clips.length === 0 ? (
        <Empty icon="star" title="No highlights here yet">
          Import a video and run AI analysis — ranked clips will appear here. You can also create a clip manually from the editor.
          <div className="mt-3">
            <Link href="/import">
              <Button variant="primary">Import media</Button>
            </Link>
          </div>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clips.map((c) => (
            <ClipCard key={c.id} clip={c} onChange={reload} />
          ))}
        </div>
      )}
    </>
  );
}

export default function HighlightsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
