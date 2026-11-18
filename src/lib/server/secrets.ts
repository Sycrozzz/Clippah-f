import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDirs } from "./paths";

/**
 * API keys are encrypted at rest with AES-256-GCM. The master key comes from
 * CLIPPAHH_SECRET (e.g. supplied by the OS credential store / launcher) or is
 * generated once into a 0600 file inside the app data directory.
 * Keys are never returned to the browser and never logged.
 */
let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.CLIPPAHH_SECRET;
  if (env && env.length >= 16) {
    cachedKey = crypto.createHash("sha256").update(env).digest();
    return cachedKey;
  }
  ensureDirs();
  const file = path.join(DATA_DIR, ".secret");
  let raw: string;
  if (fs.existsSync(file)) raw = fs.readFileSync(file, "utf8").trim();
  else {
    raw = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, raw, { mode: 0o600 });
  }
  cachedKey = crypto.createHash("sha256").update(raw).digest();
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string | null {
  try {
    const [v, iv, tag, data] = blob.split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(s: string): string {
  return s.length <= 8 ? "••••" : `••••${s.slice(-4)}`;
}
