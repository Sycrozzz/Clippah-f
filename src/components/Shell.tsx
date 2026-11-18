"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Spinner } from "./ui";
import { useApi, type JobItem, type SystemInfo } from "@/lib/client/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: "home" },
  { href: "/import", label: "Import Media", icon: "upload" },
  { href: "/analysis", label: "AI Analysis", icon: "sparkles" },
  { href: "/highlights", label: "Highlights", icon: "star" },
  { href: "/exports", label: "Export Manager", icon: "download" },
  { href: "/projects", label: "Project Library", icon: "folder" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--c-accent)" />
            <stop offset="1" stopColor="var(--c-accent2)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#lg)" />
        <path d="M11 9.5v13l11-6.5z" fill="white" />
        <path d="M8 24.5h16" stroke="white" strokeOpacity=".6" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="text-lg font-semibold tracking-tight">Clippahh</span>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: jobs } = useApi<{ jobs: JobItem[] }>("/api/jobs?active=1", { interval: 2500 });
  const { data: sys } = useApi<SystemInfo>("/api/system");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: string }[]>([]);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; kind: string };
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, ...d }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener("clippahh-toast", h);
    return () => window.removeEventListener("clippahh-toast", h);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("clippahh-theme", next);
    void fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { appearance: { theme: next } } }) });
  };

  const active = jobs?.jobs ?? [];
  const running = active.find((j) => j.status === "running");
  const isEditor = path.startsWith("/editor");

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel/60 p-4 md:flex">
        <Link href="/" className="mb-6 px-1">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${on ? "bg-accent/15 font-medium text-fg ring-1 ring-accent/30" : "text-muted hover:bg-panel2 hover:text-fg"}`}
              >
                <Icon name={n.icon} className={`h-4 w-4 ${on ? "text-accent" : ""}`} />
                {n.label}
                {n.href === "/analysis" && active.length > 0 && (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Spinner className="h-2.5 w-2.5" />
                    {active.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {running && (
          <Link href="/analysis" className="mb-3 block rounded-lg border border-line bg-panel2 p-3 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{running.stage}</span>
              <span className="text-muted">{Math.round(running.progress * 100)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-all" style={{ width: `${running.progress * 100}%` }} />
            </div>
            <div className="mt-1 truncate text-muted">{running.mediaName ?? running.type}</div>
          </Link>
        )}
        <div className="flex items-center justify-between rounded-lg px-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${sys ? (sys.hardware.ffmpeg ? "bg-emerald-400" : "bg-rose-500") : "bg-line"}`} />
            {sys ? (sys.hardware.ffmpeg ? `FFmpeg ${sys.hardware.ffmpeg.version}${sys.hardware.nvenc ? " · NVENC" : ""}` : "FFmpeg missing") : "Checking…"}
          </span>
          <button onClick={toggleTheme} className="rounded p-1 hover:bg-panel2 hover:text-fg" aria-label="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-panel/60 p-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`shrink-0 rounded-md px-3 py-1.5 text-xs ${path === n.href ? "bg-accent/20" : "text-muted"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        {sys && !sys.hardware.ffmpeg && (
          <div className="border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-sm text-rose-300">
            FFmpeg was not found, so media can’t be processed. Reinstall Clippahh or set the FFMPEG_PATH environment variable.
          </div>
        )}
        <main className={`min-h-0 flex-1 overflow-y-auto ${isEditor ? "" : "px-6 py-6 lg:px-10"}`}>
          <div className={isEditor ? "h-full" : "mx-auto max-w-6xl fade-up"}>{children}</div>
        </main>
      </div>

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto fade-up rounded-lg border px-3 py-2 text-sm shadow-xl backdrop-blur ${t.kind === "error" ? "border-rose-500/40 bg-rose-950/90 text-rose-200" : t.kind === "success" ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200" : "border-line bg-panel2/95"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
