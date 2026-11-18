import type { Category, Cue } from "@/lib/shared/types";
import { normalize } from "./text";

const DICT: Record<Exclude<Category, "general">, string[]> = {
  gaming: ["minecraft", "fortnite", "gta", "valorant", "warzone", "apex", "league of legends", "cs2", "counter strike", "roblox", "elden ring", "overwatch", "kill", "respawn", "loadout", "squad", "lobby", "ranked", "boss", "spawn", "noob", "gameplay", "headshot", "clutch", "ult", "creeper", "nether", "build", "rotate", "round", "match", "controller", "fps"],
  comedy: ["funny", "joke", "hilarious", "laugh", "lol", "prank", "punchline", "skit", "comedy", "roast", "bit"],
  podcast: ["podcast", "episode", "guest", "interview", "welcome back", "today we", "my guest", "sponsor", "subscribe", "question", "opinion", "conversation", "discuss", "topic"],
  reaction: ["reaction", "reacting", "react", "watch this", "look at this", "let's see", "trailer", "this video", "commentary", "first time watching", "my reaction"],
  irl: ["walking", "outside", "chat look", "irl", "street", "stream from", "airport", "restaurant", "drive", "driving", "hotel", "city", "people", "shop"],
  drama: ["drama", "beef", "exposed", "controversy", "cancel", "lawsuit", "argument", "allegation", "apology", "callout", "debate", "disagree", "you're wrong", "lying", "fight"],
  sports: ["goal", "score", "touchdown", "referee", "penalty", "quarter", "halftime", "match point", "dunk", "innings", "tournament", "playoff", "league", "coach", "stadium", "knockout", "round one", "free throw"],
  storytelling: ["story", "one time", "back then", "i remember", "so basically", "years ago", "growing up", "and then", "long story", "when i was", "happened to me", "childhood"],
};

export interface CategoryResult {
  category: Category;
  confidence: number;
  scores: Record<string, number>;
}

export function classifyHeuristic(
  segments: Cue[],
  stats: { meanMotion: number; cutsPerMin: number; laughterRatio: number; speechRatio: number; hasChat: boolean; hasVideo: boolean },
): CategoryResult {
  const text = normalize(segments.map((s) => s.text).join(" "));
  const words = Math.max(1, text.split(" ").length);
  const scores: Record<string, number> = {};
  for (const [cat, terms] of Object.entries(DICT)) {
    let hits = 0;
    for (const t of terms) {
      const re = new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "g");
      hits += (text.match(re) ?? []).length;
    }
    scores[cat] = (hits / words) * 100;
  }
  // non-textual priors
  if (stats.hasVideo && stats.meanMotion > 0.06) scores.gaming += 0.6;
  if (stats.hasVideo && stats.cutsPerMin < 1 && stats.speechRatio > 0.6) scores.podcast += 0.4;
  if (stats.laughterRatio > 0.04) scores.comedy += 0.8;
  if (stats.hasChat) scores.gaming += 0.3;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestV] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  if (!segments.length && bestV < 0.5) return { category: "general", confidence: 0.2, scores };
  if (bestV < 0.25) return { category: "general", confidence: 0.3, scores };
  const confidence = Math.min(0.85, 0.35 + (bestV - second) / (bestV + 0.5));
  return { category: best as Category, confidence, scores };
}
