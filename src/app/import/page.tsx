"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, ErrorBanner, Field, Icon, Notice, PageHeader, Progress, Spinner, Toggle, inputCls } from "@/components/ui";
import MediaCard from "@/components/MediaCard";
import AnalyzeDialog from "@/components/AnalyzeDialog";
import Recorder from "@/components/Recorder";
import { api, errMsg, toast, useApi, type JobItem, type MediaItem, type ProjectRow, type SystemInfo } from "@/lib/client/api";
import { collectDropped, isMediaName, uploadFile } from "@/lib/client/upload";
import { fmtBytes } from "@/lib/shared/time";

type UploadItem = { name: string; size: number; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string };
type Tab = "files" | "path" | "link" | "record";

function ImportInner() {
  const sp = useSearchParams();
  const { data: pd, reload: reloadProjects } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [tab, setTab] = useState<Tab>("files");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyze, setAnalyze] = useState<MediaItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const { data: sys } = useApi<SystemInfo>("/api/system");
  const { data: md, reload: reloadMedia } = useApi<{ media: MediaItem[] }>(projectId ? `/api/media?projectId=${projectId}` : null, { interval: 5000 });
  const { data: dl } = useApi<{ jobs: JobItem[] }>(projectId ? `/api/jobs?type=download&projectId=${projectId}&limit=5` : null, { interval: 2000 });

  useEffect(() => {
    const q = Number(sp.get("project"));
    if (q) setProjectId(q);
  }, [sp]);
  useEffect(() => {
    if (!projectId && pd?.projects.length) setProjectId(pd.projects[0].id);
  }, [pd, projectId]);

  const createProject = async () => {
    try {
      const r = await api<{ project: { id: number } }>("/api/projects", { method: "POST", json: { name: newName } });
      setNewName("");
      await reloadProjects();
      setProjectId(r.project.id);
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const enqueueFiles = useCallback(
    (files: File[]) => {
      if (!projectId) return setErr("Select or create a project first.");
      const valid = files.filter((f) => isMediaName(f.name));
      const skipped = files.length - valid.length;
      if (skipped) toast(`${skipped} file${skipped > 1 ? "s were" : " was"} skipped (unsupported format).`, "error");
      if (!valid.length) return;
      setUploads((u) => [...u, ...valid.map((f) => ({ name: f.name, size: f.size, progress: 0, status: "queued" as const }))]);
      for (const f of valid) {
        queueRef.current = queueRef.current.then(async () => {
          const upd = (patch: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.name === f.name && x.size === f.size && x.status !== "done" && x.status !== "error" ? { ...x, ...patch } : x)));
          upd({ status: "uploading" });
          try {
            await uploadFile(f, projectId, (p) => upd({ progress: p }));
            upd({ status: "done", progress: 1 });
            void reloadMedia();
          } catch (e) {
            upd({ status: "error", error: errMsg(e) });
          }
        });
      }
    },
    [projectId, reloadMedia],
  );

  const importPath = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ imported: unknown[]; failed: { file: string; error: string }[] }>("/api/media/import", { method: "POST", json: { projectId, path } });
      toast(`Imported ${r.imported.length} file${r.imported.length === 1 ? "" : "s"}`, "success");
      if (r.failed.length) setErr(`${r.failed.length} file(s) failed: ${r.failed.slice(0, 3).map((f) => `${f.file.split(/[\\/]/).pop()} — ${f.error}`).join("; ")}`);
      setPath("");
      void reloadMedia();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const importUrl = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/media/import", { method: "POST", json: { projectId, url, rights } });
      toast("Download queued", "success");
      setUrl("");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string, string][] = [
    ["files", "Files & folders", "upload"],
    ["path", "Local path", "folder"],
    ["link", "Online link", "link"],
    ["record", "Record", "cam"],
  ];

  return (
    <>
      <PageHeader title="Import Media" subtitle="Bring in recordings, streams and clips. Local files are processed on your machine." />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Project" className="min-w-56 flex-1">
            <select className={inputCls} value={projectId ?? ""} onChange={(e) => setProjectId(+e.target.value || null)}>
              {!pd?.projects.length && <option value="">No projects — create one →</option>}
              {pd?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New project" className="min-w-56 flex-1">
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newName.trim() && createProject()} />
              <Button disabled={!newName.trim()} onClick={createProject}>
                <Icon name="plus" /> Create
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {tabs.map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${tab === id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            <Icon name={icon} /> {label}
          </button>
        ))}
      </div>

      <div className="mb-8 space-y-4">
        <ErrorBanner message={err} onDismiss={() => setErr(null)} />

        {tab === "files" && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDrag(false);
                enqueueFiles(await collectDropped(e.dataTransfer));
              }}
              className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${drag ? "border-accent bg-accent/10" : "border-line bg-panel/50"}`}
            >
              <div className="mb-3 rounded-full bg-accent/15 p-4 text-accent">
                <Icon name="upload" className="h-7 w-7" />
              </div>
              <p className="font-medium">Drag & drop videos, audio or whole folders</p>
              <p className="mt-1 text-xs text-muted">MP4 · MOV · MKV · AVI · WebM · WMV · FLV · MP3 · WAV · AAC · M4A · FLAC · OGG</p>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" disabled={!projectId} onClick={() => fileRef.current?.click()}>
                  Choose files
                </Button>
                <Button disabled={!projectId} onClick={() => dirRef.current?.click()}>
                  Choose folder
                </Button>
              </div>
              <input ref={fileRef} type="file" multiple hidden accept="video/*,audio/*,.mkv,.flv,.wmv,.avi,.flac" onChange={(e) => { enqueueFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <input ref={dirRef} type="file" hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { enqueueFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </div>
            <p className="text-xs text-muted">Files are streamed to Clippahh’s local library folder, then validated with FFprobe. Very large recordings are never loaded into memory. To avoid copying huge files, use “Local path” to reference them in place.</p>
            {uploads.length > 0 && (
              <div className="space-y-2">
                {uploads.slice(-8).map((u, i) => (
                  <div key={i} className="rounded-lg border border-line bg-panel px-3 py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{u.name}</span>
                      <span className="ml-3 flex shrink-0 items-center gap-2 text-xs text-muted">
                        {fmtBytes(u.size)}
                        {u.status === "uploading" && <Spinner className="h-3 w-3" />}
                        {u.status === "done" && <Badge tone="green">Imported</Badge>}
                        {u.status === "queued" && <Badge>Queued</Badge>}
                        {u.status === "error" && <Badge tone="red">Failed</Badge>}
                      </span>
                    </div>
                    {u.status === "uploading" && <div className="mt-1.5"><Progress value={u.progress} /></div>}
                    {u.error && <p className="mt-1 text-xs text-rose-400">{u.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "path" && (
          <Card className="space-y-3 p-5">
            <Field label="File or folder path on this computer" hint="Imports one file, or every supported media file in a folder (recursively). Files stay where they are — nothing is copied or deleted.">
              <input className={inputCls} placeholder="D:\Recordings\2025-stream.mkv  or  D:\Recordings\OBS" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && path.trim() && importPath()} />
            </Field>
            <Button variant="primary" disabled={!path.trim() || !projectId || busy} onClick={importPath}>
              {busy ? <Spinner /> : <Icon name="folder" />} Import
            </Button>
          </Card>
        )}

        {tab === "link" && (
          <div className="space-y-4">
            <Card className="space-y-3 p-5">
              <Field label="Media link" hint="Direct link to a video/audio file you’re allowed to download. Private/internal network addresses are blocked.">
                <input className={inputCls} placeholder="https://example.com/video.mp4  or  https://www.twitch.tv/videos/…" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Toggle checked={rights} onChange={setRights} label="I own this content or have permission to download and edit it" hint="Required for platform links (YouTube, Twitch, Kick, TikTok, Instagram). Clippahh never bypasses logins, DRM or access controls." />
              <Button variant="primary" disabled={!url.trim() || !projectId || busy} onClick={importUrl}>
                {busy ? <Spinner /> : <Icon name="download" />} Download & import
              </Button>
              {(dl?.jobs ?? []).slice(0, 3).map((j) => (
                <div key={j.id} className="rounded-lg bg-bg p-3 text-xs">
                  <div className="flex justify-between">
                    <span>{j.message || "Download"}</span>
                    <Badge tone={j.status === "failed" ? "red" : j.status === "completed" ? "green" : "cyan"}>{j.status}</Badge>
                  </div>
                  {(j.status === "running" || j.status === "queued") && <div className="mt-2"><Progress value={j.progress} indeterminate={j.progress === 0} /></div>}
                  {j.error && <p className="mt-1 text-rose-400">{j.error}</p>}
                </div>
              ))}
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">How each platform is handled</h3>
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-line">
                  {[
                    ["YouTube / Twitch VODs / Kick VODs / TikTok / Instagram", sys?.ytDlp ? "Links work through the optional yt-dlp tool (detected). Use only for content you own or have permission to use; private or login-gated videos will fail." : "Needs the optional yt-dlp tool (not detected). Alternatively download your own video via the platform’s official export (e.g. YouTube Studio, Twitch Highlights) and import the file."],
                    ["Live streams", "Record with OBS (or the Record tab) and import the file. Clippahh does not capture protected streams."],
                    ["Twitch / Kick chat", "Attach an exported chat log (TwitchDownloader JSON, CSV or timestamped text) to a media file to enable chat-reaction analysis. Only use chat data you’re authorised to access."],
                  ].map(([a, b]) => (
                    <tr key={a}>
                      <td className="w-1/3 py-2 pr-4 align-top font-medium">{a}</td>
                      <td className="py-2 text-muted">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {tab === "record" && (
          <Card className="p-5">
            <Recorder projectId={projectId} onSaved={reloadMedia} />
          </Card>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Media in this project {md ? `(${md.media.length})` : ""}</h2>
        {!projectId ? (
          <Notice>Create a project to begin importing.</Notice>
        ) : (md?.media ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing imported yet.</p>
        ) : (
          <div className="space-y-3">
            {md!.media.map((m) => (
              <MediaCard key={m.id} m={m} onChange={reloadMedia} onAnalyze={setAnalyze} />
            ))}
          </div>
        )}
      </section>
      {analyze && <AnalyzeDialog media={analyze} onClose={() => setAnalyze(null)} />}
    </>
  );
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportInner />
    </Suspense>
  );
}
