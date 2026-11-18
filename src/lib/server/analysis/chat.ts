import type { Signal } from "@/lib/shared/types";
import { clamp, parseTime } from "@/lib/shared/time";

export interface ChatMessage {
  t: number; // seconds from video start
  user: string;
  text: string;
}

/**
 * Parses chat logs exported from authorised sources:
 *  - TwitchDownloader JSON ({ comments: [{ content_offset_seconds, commenter, message }] })
 *  - Generic JSON arrays ([{ time|offset|timestamp, user, message|text|body }])
 *  - CSV (seconds,user,message) and text lines "[00:12:34] user: message"
 */
export function parseChatLog(raw: string): ChatMessage[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const out: ChatMessage[] = [];
  if (text.startsWith("{") || /^\[\s*[{\]"]/.test(text)) {
    let j: unknown;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("The chat file looks like JSON but could not be parsed.");
    }
    const arr = Array.isArray(j) ? j : ((j as { comments?: unknown[]; messages?: unknown[] }).comments ?? (j as { messages?: unknown[] }).messages ?? []);
    for (const c of arr as Record<string, unknown>[]) {
      const t = Number(c.content_offset_seconds ?? c.offset ?? c.time ?? c.timestamp ?? c.t);
      const msgField = c.message ?? c.text ?? c.body ?? c.content;
      const body = typeof msgField === "string" ? msgField : String((msgField as { body?: string } | undefined)?.body ?? "");
      const commenter = c.commenter as { display_name?: string; name?: string } | undefined;
      const user = String(commenter?.display_name ?? commenter?.name ?? c.user ?? c.username ?? c.author ?? "");
      if (Number.isFinite(t) && body) out.push({ t, user, text: body });
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      let m = /^\[?(\d+(?::\d+){1,2}(?:\.\d+)?)\]?\s+(?:<)?([^:>]{1,40})(?:>)?:\s*(.+)$/.exec(line);
      if (m) {
        const t = parseTime(m[1]);
        if (t !== null) out.push({ t, user: m[2].trim(), text: m[3].trim() });
        continue;
      }
      m = /^(\d+(?:\.\d+)?|\d+(?::\d+){1,2}),\s*"?([^",]*)"?,\s*"?(.+?)"?$/.exec(line);
      if (m) {
        const t = parseTime(m[1]);
        if (t !== null) out.push({ t, user: m[2], text: m[3] });
      }
    }
  }
  const msgs = out.filter((m) => m.t >= 0).sort((a, b) => a.t - b.t);
  if (!msgs.length) throw new Error("No chat messages with timestamps could be read from this file.");
  return msgs;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Detect message-rate surges and emote-spam in chat, aligned to video time. */
export function analyzeChat(messages: ChatMessage[], duration: number): { signals: Signal[]; intensity: number[] } {
  const n = Math.max(1, Math.ceil(duration));
  const rate = new Array<number>(n).fill(0);
  for (const m of messages) if (m.t < n) rate[Math.floor(m.t)]++;
  const WIN = 10;
  const smooth = rate.map((_, i) => {
    let s = 0;
    for (let k = Math.max(0, i - WIN + 1); k <= i; k++) s += rate[k];
    return s;
  });
  // rolling baseline over 3 minutes
  const baseline = smooth.map((_, i) => median(smooth.slice(Math.max(0, i - 90), Math.min(n, i + 90)).filter((_, k) => k % 3 === 0)));
  const mad = median(smooth.map((v, i) => Math.abs(v - baseline[i])));
  const signals: Signal[] = [];
  const intensity = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    const z = (smooth[i] - baseline[i]) / (mad * 1.4826 + 1);
    if (z > 3 && smooth[i] >= 5 && smooth[i] > baseline[i] * 1.8) {
      let j = i;
      let peakZ = z;
      let peakIdx = i;
      while (j < n && (smooth[j] - baseline[j]) / (mad * 1.4826 + 1) > 1.5) {
        const zz = (smooth[j] - baseline[j]) / (mad * 1.4826 + 1);
        if (zz > peakZ) {
          peakZ = zz;
          peakIdx = j;
        }
        j++;
      }
      const start = Math.max(0, i - WIN); // surge window covers the preceding 10 s of messages
      const burst = messages.filter((m) => m.t >= peakIdx - WIN && m.t <= peakIdx + 1);
      const freq = new Map<string, number>();
      for (const m of burst) {
        const tok = m.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        if (tok) freq.set(tok, (freq.get(tok) ?? 0) + 1);
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
      const repeatShare = top ? top[1] / Math.max(1, burst.length) : 0;
      const users = new Set(burst.map((m) => m.user)).size;
      const inten = clamp(0.35 + peakZ / 14 + repeatShare * 0.2, 0.3, 1);
      const x = baseline[peakIdx] > 0 ? (smooth[peakIdx] / baseline[peakIdx]).toFixed(1) : "∞";
      signals.push({
        family: "chat",
        kind: repeatShare > 0.35 && burst.length >= 8 ? "emote_spam" : "chat_surge",
        time: start,
        end: Math.min(n, j + 2),
        intensity: inten,
        label: `${repeatShare > 0.35 ? "Emote/message spam" : "Chat surge"}: ${smooth[peakIdx]} msgs/10s (${x}× normal, ${users} chatters)${top ? `, top reaction “${top[0]}”` : ""}`,
      });
      for (let k = start; k < Math.min(n, j + 2); k++) intensity[k] = Math.max(intensity[k], inten);
      i = j + 1;
    } else i++;
  }
  return { signals, intensity };
}
