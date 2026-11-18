"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Empty, Icon, PageHeader, Progress, inputCls, statusTone, ErrorBanner } from "@/components/ui";
import ExportForm from "@/components/ExportForm";
import { fmtEta } from "@/components/JobCard";
import { api, errMsg, toast, useApi, type ClipItem, type ProjectRow, type SystemInfo } from "@/lib/client/api";
import { DEFAULT_EXPORT } from "@/lib/shared/defaults";
import { fmtBytes, fmtDuration } from "@/lib/shared/time";
import type { AppSettings, ExportSettings } from "@/lib/shared/types";

interface ExportRow {
  id: number;
  clipId: number | null;
  projectName: string;
  title: string;
  settings: ExportSettings;
  filePath: string | null;
  hasSrt: boolean;
  sizeBytes: number;
  durationSec: number;
  status: string;
  error: string | null;
  createdAt: string;
  jobStatus: string | null;
  jobStage: string | null;
  progress: number | null;
  etaSeconds: number | null;
}

function Inner() {
  const sp = useSearchParams();
  const [project, setProject] = useState(sp.get("project") ?? "");
  const { data: pd } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const { data: cd } = useApi<{ clips: ClipItem[] }>(`/api/clips?status=approved&sort=score${project ? `&projectId=${project}` : ""}`, { interval: 8000 });
  const { data: ed, reload } = useApi<{ exports: ExportRow[] }>(`/api/exports${project ? `?projectId=${project}` : ""}`, { interval: 1500 });
  const { data: sys } = useApi<SystemInfo>("/api/system");
  const { data: sd } = useApi<{ settings: AppSettings }>("/api/settings");
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (sd) setSettings(sd.settings.export);
  }, [sd]);
  const clips = useMemo(() => cd?.clips ?? [], [cd]);
  useEffect(() => setSel(new Set(clips.map((c) => c.id))), [clips]);

  const chosen = clips.filter((c) => sel.has(c.id));
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/exports", { method: "POST", json: { clipIds: chosen.map((c) => c.id), settings } });
      toast(`${chosen.length} export${chosen.length > 1 ? "s" : ""} queued`, "success");
      void reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const saveDefaults = async () => {
    try {
      await api("/api/settings", { method: "PUT", json: { settings: { export: settings } } });
      toast("Saved as default export settings", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const exportsList = ed?.exports ?? [];

  return (
    <>
      <PageHeader title="Export Manager" subtitle="Batch-export approved clips with platform presets, hardware acceleration and verified output.">
        <select className={`${inputCls} !w-auto`} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {pd?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </PageHeader>
      <ErrorBanner message={err} onDismiss={() => setErr(null)} />

      <div className="mt-4 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Approved clips ({chosen.length}/{clips.length})</h2>
            <div className="flex gap-2 text-xs">
              <button className="text-accent hover:underline" onClick={() => setSel(new Set(clips.map((c) => c.id)))}>
                Select all
              </button>
              <button className="text-muted hover:underline" onClick={() => setSel(new Set())}>
                None
              </button>
            </div>
          </div>
          {clips.length === 0 ? (
            <Empty icon="check" title="No approved clips">
              Approve clips on the Highlights page (or in the editor) to export them here.
            </Empty>
          ) : (
            <div className="space-y-2">
              {clips.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-panel p-2 pr-3 transition ${sel.has(c.id) ? "border-accent/60" : "border-line"}`}>
                  <input
                    type="checkbox"
                    className="ml-1 h-4 w-4 accent-[var(--c-accent)]"
                    checked={sel.has(c.id)}
                    onChange={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  />
                  <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-black">
                    {c.hasThumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/clips/${c.id}/thumb`} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted">
                      {fmtDuration(c.endSec - c.startSec)} · {c.aspect} · score {Math.round(c.score)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>
        <aside className="lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Export settings</h2>
            <ExportForm value={settings} onChange={setSettings} sys={sys} durations={chosen.map((c) => c.endSec - c.startSec)} />
            <div className="mt-4 flex gap-2">
              <Button variant="primary" className="flex-1" disabled={busy || chosen.length === 0} onClick={start}>
                <Icon name="download" /> Export {chosen.length} clip{chosen.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" onClick={saveDefaults} title="Use these settings as defaults">
                Save default
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold">Export history</h2>
        {exportsList.length === 0 ? (
          <p className="text-sm text-muted">No exports yet.</p>
        ) : (
          <div className="space-y-2">
            {exportsList.map((x) => {
              const live = x.status === "queued" || x.status === "running";
              return (
                <div key={x.id} className="rounded-xl border border-line bg-panel p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={statusTone(x.status)}>{x.status}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{x.title}</p>
                      <p className="truncate text-xs text-muted">
                        {x.projectName} · {x.settings.preset} · {x.settings.codec.toUpperCase()} .{x.settings.format}
                        {x.status === "completed" && ` · ${fmtBytes(x.sizeBytes)} · ${fmtDuration(x.durationSec)}`}
                      </p>
                      {x.filePath && x.status === "completed" && <p className="truncate font-mono text-[11px] text-muted" title={x.filePath}>{x.filePath}</p>}
                    </div>
                    <div className="flex gap-2">
                      {x.status === "completed" && (
                        <>
                          <a href={`/api/exports/${x.id}`}>
                            <Button size="sm" variant="primary">
                              <Icon name="download" className="h-3.5 w-3.5" /> Download
                            </Button>
                          </a>
                          {x.hasSrt && (
                            <a href={`/api/exports/${x.id}?srt=1`}>
                              <Button size="sm">.srt</Button>
                            </a>
                          )}
                        </>
                      )}
                      {(x.status === "failed" || x.status === "cancelled") && x.clipId && (
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              await api("/api/exports", { method: "POST", json: { clipIds: [x.clipId], settings: x.settings } });
                              void reload();
                            } catch (e) {
                              toast(errMsg(e), "error");
                            }
                          }}
                        >
                          <Icon name="refresh" className="h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => api(`/api/exports/${x.id}${x.status === "completed" ? "" : ""}`, { method: "DELETE" }).then(reload).catch((e) => toast(errMsg(e), "error"))} title={live ? "Cancel" : "Remove from history (file is kept)"}>
                        <Icon name={live ? "x" : "trash"} className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {live && (
                    <div className="mt-2">
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>{x.status === "queued" ? "Queued" : x.jobStage}</span>
                        <span>{x.status === "running" ? `${Math.round((x.progress ?? 0) * 100)}% ${fmtEta(x.etaSeconds)}` : ""}</span>
                      </div>
                      <Progress value={x.progress ?? 0} indeterminate={x.status === "queued"} />
                    </div>
                  )}
                  {x.error && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{x.error}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export default function ExportsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
