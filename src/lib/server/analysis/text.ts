import type { Cue, Signal } from "@/lib/shared/types";
import { clamp } from "@/lib/shared/time";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Custom keyword / phrase search over transcript. Whole-word, accent- and case-insensitive. */
export function findKeywordMatches(segments: Cue[], keywords: string[]): Signal[] {
  const out: Signal[] = [];
  const kws = keywords.map((k) => normalize(k)).filter((k) => k.length >= 2);
  for (const seg of segments) {
    const text = normalize(seg.text);
    for (const kw of kws) {
      if (new RegExp(`(^|\\s)${esc(kw)}(\\s|$)`).test(text)) {
        out.push({ family: "keyword", kind: "keyword", time: seg.start, end: seg.end, intensity: 1, label: `Keyword “${kw}”: “${seg.text.trim().slice(0, 90)}”` });
      }
    }
  }
  return out;
}

interface Rule {
  kind: string;
  family: "semantic" | "game";
  label: string;
  weight: number;
  re: RegExp;
}

const RULES: Rule[] = [
  { kind: "surprise", family: "semantic", label: "Surprise / disbelief", weight: 0.7, re: /\b(no way|oh my god|omg|what the (hell|heck|fuck)|are you serious|you('re| are) kidding|holy (shit|crap|cow|moly)|wait what|what just happened|i can'?t believe|unbelievable|no shot|bro what|what\?!)\b/ },
  { kind: "revelation", family: "semantic", label: "Revelation / confession", weight: 0.75, re: /\b(the truth is|i have to tell you|i('ve| have) never told|secret|turns out|plot twist|nobody knows|i found out|it was (him|her|me)|i lied|confess|actually it was)\b/ },
  { kind: "joke", family: "semantic", label: "Joke / laughter cue", weight: 0.65, re: /\b(ha ?ha+|lol|lmao|rofl|that'?s hilarious|i'?m dying|so funny|joke|punchline|dead 💀|crying)\b/ },
  { kind: "argument", family: "semantic", label: "Argument / confrontation", weight: 0.7, re: /\b(you'?re (wrong|lying|an idiot)|that'?s (not true|a lie|bs|bullshit)|shut up|let me finish|don'?t talk over|i disagree|how dare|explain yourself|are you (stupid|dumb)|apologi[sz]e|what is wrong with you)\b/ },
  { kind: "story_hook", family: "semantic", label: "Story setup / hook", weight: 0.55, re: /\b(so (basically|this one time)|one (time|day|night)|story time|let me tell you|you won'?t believe|this is (crazy|insane|wild)|long story short|and then (he|she|they|i|we)|back in)\b/ },
  { kind: "hype", family: "semantic", label: "Hype / celebration", weight: 0.6, re: /\b(let'?s go+|lets go+|yes+!|we did it|insane|incredible|that was (sick|crazy|insane|amazing)|best (moment|day)|so good|pog|poggers|hell yeah)\b/ },
  { kind: "fail", family: "semantic", label: "Unexpected failure / mishap", weight: 0.6, re: /\b(oh no|why would i|i messed up|that'?s embarrassing|big mistake|i fell|it broke|you ruined|i'?m so dumb|worst (thing|luck))\b/ },
  { kind: "game_clutch", family: "game", label: "Inferred gameplay peak (speech cue)", weight: 0.8, re: /\b(clutch|ace|1v[2-5]|headshot|triple kill|quadra|penta|collateral|no scope|last (one|man)|we won|victory royale|victory|gg|got (him|them|em)|he'?s dead|i killed|cracked|wiped|team wipe|let'?s go)\b/ },
  { kind: "game_fail", family: "game", label: "Inferred gameplay failure (speech cue)", weight: 0.6, re: /\b(i died|i'?m dead|rage quit|fell off|griefed|lag(ged|ging)?|disconnect(ed)?|what was that|how did i miss|i got (killed|sniped|trolled)|bruh)\b/ },
  { kind: "game_achieve", family: "game", label: "Inferred achievement (speech cue)", weight: 0.65, re: /\b(achievement|world record|first try|speedrun|personal best|new (high ?score|record)|level up|boss (down|dead)|beat the (game|boss)|rank(ed)? up|diamond|netherite)\b/ },
];

/** Rule-based text analysis used when no LLM is configured (clearly labelled as heuristic). */
export function analyzeTranscriptHeuristic(segments: Cue[]): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const raw = seg.text;
    const norm = normalize(raw);
    for (const r of RULES) {
      const m = r.re.exec(norm);
      if (!m) continue;
      let w = r.weight;
      const excl = (raw.match(/!/g) ?? []).length;
      if (excl >= 2) w += 0.1;
      if (/[A-Z]{4,}/.test(raw)) w += 0.05;
      out.push({ family: r.family, kind: r.kind, time: seg.start, end: seg.end, intensity: clamp(w, 0.2, 1), label: `${r.label}: “${raw.trim().slice(0, 90)}”` });
    }
    // Rapid back-and-forth: several short segments in a row = conversation intensity / argument
    if (i >= 3) {
      const win = segments.slice(i - 3, i + 1);
      const span = win[3].end - win[0].start;
      const avgLen = win.reduce((a, s) => a + s.text.length, 0) / 4;
      if (span < 9 && avgLen < 40 && win.every((s) => s.text.includes("?") || s.text.includes("!") || s.text.length < 25)) {
        out.push({ family: "semantic", kind: "rapid_exchange", time: win[0].start, end: win[3].end, intensity: 0.4, label: "Rapid back-and-forth exchange" });
      }
    }
    // Repeated words ("no no no", "wait wait wait")
    const rep = /\b(\w{2,})( \1){2,}\b/.exec(norm);
    if (rep) out.push({ family: "semantic", kind: "repetition", time: seg.start, end: seg.end, intensity: 0.45, label: `Emphatic repetition: “${rep[0]}”` });
  }
  return out;
}

/** Speech density per second (0..1), used as context for narrative completeness. */
export function speechDensity(segments: Cue[], seconds: number): number[] {
  const out = new Array<number>(Math.max(1, Math.ceil(seconds))).fill(0);
  for (const s of segments) {
    for (let t = Math.floor(s.start); t < Math.min(out.length, Math.ceil(s.end)); t++) out[t] = 1;
  }
  return out;
}
