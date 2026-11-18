"use client";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

const ICONS: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  upload: "M12 16V4m0 0L7 9m5-5l5 5M4 20h16",
  sparkles: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  scissors: "M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.5 8l11 9M8.5 16l11-9",
  download: "M12 4v12m0 0l-5-5m5 5l5-5M4 20h16",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6L6 18",
  play: "M8 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M9 9h10v10H9zM5 15V5h10",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
  mic: "M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.01",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  cam: "M3 7h12v10H3zM15 11l6-3v8l-6-3",
  screen: "M3 5h18v12H3zM8 21h8M12 17v4",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  loop: "M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3",
  stop: "M6 6h12v12H6z",
  zoomin: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M11 8v6M8 11h6",
  zoomout: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M21 13A9 9 0 1111 3a7 7 0 0010 10z",
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  );
}

type Variant = "default" | "primary" | "danger" | "ghost" | "success";
export function Button({ variant = "default", size = "md", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const v: Record<Variant, string> = {
    default: "bg-panel2 hover:bg-line border border-line text-fg",
    primary: "bg-gradient-to-r from-accent to-[color-mix(in_srgb,var(--c-accent)_60%,var(--c-accent2))] text-white hover:brightness-110 shadow-lg shadow-accent/20 border border-transparent",
    danger: "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30",
    success: "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    ghost: "hover:bg-panel2 text-muted hover:text-fg border border-transparent",
  };
  const s = size === "sm" ? "px-2.5 py-1 text-xs gap-1.5" : "px-3.5 py-2 text-sm gap-2";
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] ${v[variant]} ${s} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-panel ${className}`}>{children}</div>;
}

export function Badge({ children, tone = "default", title }: { children: ReactNode; tone?: "default" | "accent" | "green" | "amber" | "red" | "cyan"; title?: string }) {
  const t = {
    default: "bg-panel2 text-muted border-line",
    accent: "bg-accent/15 text-accent border-accent/30",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    red: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${t}`}>
      {children}
    </span>
  );
}

export function Progress({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
      <div
        className={`h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-500 ${indeterminate ? "shimmer w-full" : ""}`}
        style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`fade-up flex max-h-[90vh] w-full flex-col rounded-2xl border border-line bg-panel shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? "#34d399" : score >= 50 ? "#fbbf24" : "#fb7185";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`AI highlight score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{score}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-panel2 p-3 text-muted">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300" role="alert">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const c = tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-accent/30 bg-accent/10 text-fg";
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${c}`}>
      <Icon name={tone === "warn" ? "alert" : "info"} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-1 focus:ring-accent/40";
export const labelCls = "mb-1 block text-xs font-medium text-muted";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
      <span className="text-sm">
        {label}
        {hint && <span className="block text-[11px] leading-snug text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function statusTone(s: string): "green" | "red" | "amber" | "cyan" | "default" {
  if (s === "completed" || s === "approved") return "green";
  if (s === "failed" || s === "rejected") return "red";
  if (s === "running") return "cyan";
  if (s === "queued" || s === "pending") return "amber";
  return "default";
}
