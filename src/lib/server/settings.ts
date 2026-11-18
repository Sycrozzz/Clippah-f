import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsTable } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/shared/defaults";
import type { AppSettings } from "@/lib/shared/types";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

export type KeyName = "transcription" | "llm";

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return (patch === undefined ? base : (patch as T)) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "app"));
  return deepMerge(DEFAULT_SETTINGS, rows[0]?.value);
}

async function getSecretMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "secrets"));
  return (rows[0]?.value as Record<string, string>) ?? {};
}

export async function getApiKey(name: KeyName): Promise<string | null> {
  const env = name === "llm" ? process.env.CLIPPAHH_LLM_API_KEY : process.env.CLIPPAHH_TRANSCRIPTION_API_KEY;
  const map = await getSecretMap();
  const stored = map[name] ? decryptSecret(map[name]) : null;
  return stored || env || null;
}

export async function getKeyStatus(): Promise<Record<KeyName, { set: boolean; masked: string }>> {
  const out = {} as Record<KeyName, { set: boolean; masked: string }>;
  for (const n of ["transcription", "llm"] as KeyName[]) {
    const k = await getApiKey(n);
    out[n] = { set: !!k, masked: k ? maskSecret(k) : "" };
  }
  return out;
}

export async function saveSettings(patch: unknown, keys?: Partial<Record<KeyName, string | null>>): Promise<AppSettings> {
  const current = await getSettings();
  const merged = deepMerge(current, patch);
  // basic validation / clamping
  merged.clips.minDuration = Math.max(3, Math.min(merged.clips.minDuration, 600));
  merged.clips.maxDuration = Math.max(merged.clips.minDuration, Math.min(merged.clips.maxDuration, 900));
  merged.clips.targetDuration = Math.max(merged.clips.minDuration, Math.min(merged.clips.targetDuration, merged.clips.maxDuration));
  merged.clips.maxClips = Math.max(1, Math.min(merged.clips.maxClips, 100));
  merged.processing.concurrency = Math.max(1, Math.min(merged.processing.concurrency, 3));
  await db
    .insert(settingsTable)
    .values({ key: "app", value: merged })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: merged, updatedAt: new Date() } });

  if (keys) {
    const map = await getSecretMap();
    for (const [name, v] of Object.entries(keys)) {
      if (v === undefined) continue;
      if (v === null || v === "") delete map[name];
      else map[name] = encryptSecret(v.trim());
    }
    await db
      .insert(settingsTable)
      .values({ key: "secrets", value: map })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: map, updatedAt: new Date() } });
  }
  return merged;
}
