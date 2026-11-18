export type Category =
  | "gaming"
  | "comedy"
  | "podcast"
  | "reaction"
  | "irl"
  | "drama"
  | "sports"
  | "storytelling"
  | "general";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "gaming", label: "Gaming" },
  { id: "comedy", label: "Comedy" },
  { id: "podcast", label: "Podcast / Conversation" },
  { id: "reaction", label: "Reaction" },
  { id: "irl", label: "IRL Stream" },
  { id: "drama", label: "Drama / Debate" },
  { id: "sports", label: "Sports" },
  { id: "storytelling", label: "Storytelling" },
  { id: "general", label: "General" },
];

export type SignalFamily = "audio" | "visual" | "semantic" | "chat" | "game" | "keyword";

export interface Signal {
  family: SignalFamily;
  kind: string;
  time: number;
  end?: number;
  intensity: number; // 0..1
  label: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleStyle {
  font: string;
  size: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  bgColor: string;
  bgOpacity: number;
  bold: boolean;
  uppercase: boolean;
  position: "bottom" | "middle" | "top";
  marginV: number;
}

export interface CropSettings {
  mode: "crop" | "blur";
  x: number; // 0..1 horizontal focus
  y: number; // 0..1 vertical focus
  zoom: number; // >= 1
}

export interface AudioSettings {
  volume: number;
  mute: boolean;
  fadeIn: number;
  fadeOut: number;
  normalize: boolean;
}

export interface ClipSubtitles {
  enabled: boolean;
  cues: Cue[]; // absolute media time
  style: SubtitleStyle;
}

export interface Evidence {
  family: SignalFamily;
  kind: string;
  time: number;
  label: string;
  strength: number;
}

export interface EngagementBreakdown {
  emotional: number;
  entertainment: number;
  context: number;
  uniqueness: number;
  narrative: number;
  overall: number;
}

export interface ClipScores {
  families: Partial<Record<SignalFamily, number>>;
  engagement: EngagementBreakdown;
  loudnessOnly: boolean;
  visualNote?: string;
}

export interface Weights {
  audio: number;
  visual: number;
  semantic: number;
  chat: number;
  game: number;
  keyword: number;
}

export interface Timeline {
  step: number;
  duration: number;
  audio: number[];
  motion: number[];
  semantic: number[];
  chat: number[];
  keyword: number[];
  game: number[];
  speech: number[];
  combined: number[];
}

export interface AnalysisConfig {
  keywords: string[];
  categoryOverride: Category | "auto";
  minDuration: number;
  maxDuration: number;
  targetDuration: number;
  maxClips: number;
  adaptive: boolean;
  weights: Weights;
  language: string;
  useChat: boolean;
  useVision: boolean;
  retranscribe: boolean;
  replaceExisting: boolean;
}

export interface JobLogEntry {
  t: number;
  kind: "info" | "event" | "warn" | "error";
  msg: string;
}

export interface ExportSettings {
  preset: string;
  aspect: string; // "clip" or ratio like "9:16" / "21:9"
  resolution: number; // short edge in px
  fps: number; // 0 = source
  codec: "h264" | "hevc" | "vp9" | "av1";
  format: "mp4" | "mov" | "mkv" | "webm";
  videoBitrate: number; // kbps, 0 = quality based
  audioBitrate: number; // kbps
  hardware: "auto" | "cpu";
  subtitleMode: "burn" | "soft" | "none";
  exportSrt: boolean;
  outputDir: string;
}

export interface AppSettings {
  transcription: {
    provider: "openai-compatible" | "whisper-cpp" | "none";
    baseUrl: string;
    model: string;
    language: string;
    whisperBinary: string;
    whisperModel: string;
  };
  llm: {
    provider: "openai-compatible" | "anthropic" | "heuristic";
    baseUrl: string;
    model: string;
    visionModel: string;
    useVision: boolean;
  };
  privacy: { allowCloud: boolean; keepTempFiles: boolean };
  processing: { gpu: "auto" | "off"; concurrency: number; autoProxy: boolean };
  clips: {
    minDuration: number;
    maxDuration: number;
    targetDuration: number;
    maxClips: number;
    adaptive: boolean;
  };
  export: ExportSettings;
  subtitles: SubtitleStyle;
  weights: Weights;
  sources: { ytDlpPath: string };
  appearance: { theme: "dark" | "light" };
}

export type JobType = "analysis" | "export" | "proxy" | "download";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
