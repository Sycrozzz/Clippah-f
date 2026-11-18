"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Empty, Field, Icon, Modal, PageHeader, inputCls } from "@/components/ui";
import { api, errMsg, toast, useApi, type ProjectRow } from "@/lib/client/api";

export default function ProjectsPage() {
  const { data, reload } = useApi<{ projects: ProjectRow[] }>("/api/projects", { interval: 8000 });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const list = useMemo(() => (data?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const create = async () => {
    try {
      await api("/api/projects", { method: "POST", json: { name } });
      setName("");
      setOpen(false);
      void reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const rename = async (p: ProjectRow) => {
    const n = prompt("Rename project", p.name);
    if (!n?.trim()) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "PATCH", json: { name: n } });
      void reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const del = async (p: ProjectRow) => {
    if (!confirm(`Delete “${p.name}”? Its media copies, clips and history will be removed. Files you imported by path and exported videos are not deleted.`)) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      void reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <>
      <PageHeader title="Project Library" subtitle="Reopen previous work — everything is saved locally and resumes where you left off.">
        <input className={`${inputCls} !w-56`} placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Icon name="plus" /> New project
        </Button>
      </PageHeader>
      {list.length === 0 ? (
        <Empty icon="folder" title={q ? "No matching projects" : "No projects yet"} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-line bg-panel">
              <Link href={`/projects/${p.id}`} className="block aspect-[16/7] bg-panel2">
                {p.thumbMediaId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${p.thumbMediaId}/thumb`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted">
                    <Icon name="folder" className="h-7 w-7" />
                  </div>
                )}
              </Link>
              <div className="p-4">
                <Link href={`/projects/${p.id}`} className="block truncate font-medium hover:text-accent">
                  {p.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">Updated {new Date(p.updatedAt).toLocaleString()}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>{p.mediaCount} media</Badge>
                  <Badge tone="accent">{p.clipCount} clips</Badge>
                  <Badge tone="green">{p.approvedCount} approved</Badge>
                  <Badge tone="cyan">{p.exportCount} exported</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link href={`/projects/${p.id}`} className="flex-1">
                    <Button size="sm" variant="primary" className="w-full">
                      Open
                    </Button>
                  </Link>
                  <Button size="sm" onClick={() => rename(p)}>
                    <Icon name="edit" className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => del(p)}>
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <div className="space-y-4">
          <Field label="Project name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={create}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
