import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = path.resolve(process.env.CLIPPAHH_DATA_DIR || path.join(process.cwd(), "data"));

export const dirs = {
  media: path.join(DATA_DIR, "media"),
  tmp: path.join(DATA_DIR, "tmp"),
  thumbs: path.join(DATA_DIR, "thumbs"),
  previews: path.join(DATA_DIR, "previews"),
  exports: path.join(DATA_DIR, "exports"),
  chat: path.join(DATA_DIR, "chat"),
  proxies: path.join(DATA_DIR, "proxies"),
};

let ensured = false;
export function ensureDirs(): void {
  if (ensured) return;
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  ensured = true;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Make a user-provided name safe to use as a file name on Windows/Linux/macOS. */
export function sanitizeFilename(name: string, fallback = "file"): string {
  let n = (name || "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  if (!n || RESERVED.test(n.split(".")[0])) n = fallback;
  return n;
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function uniquePath(dir: string, base: string, ext: string): string {
  let p = path.join(dir, `${base}${ext}`);
  let i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

export function rmSafe(p: string | null | undefined): void {
  if (!p) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
}

export function tmpDirFor(label: string): string {
  ensureDirs();
  const d = path.join(dirs.tmp, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
