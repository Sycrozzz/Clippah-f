import type { AppSettings, SubtitleStyle, CropSettings, AudioSettings, ExportSettings } from "./types";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: "Arial",
  size: 64,
  color: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 4,
  bgColor: "#000000",
  bgOpacity: 0,
  bold: true,
  uppercase: false,
  position: "bottom",
  marginV: 140,
};

export const DEFAULT_CROP: CropSettings = { mode: "crop", x: 0.5, y: 0.5, zoom: 1 };
export const DEFAULT_AUDIO: AudioSettings = { volume: 1, mute: false, fadeIn: 0, fadeOut: 0, normalize: false };

export const DEFAULT_EXPORT: ExportSettings = {
  preset: "youtube-shorts",
  aspect: "clip",
  resolution: 1080,
  fps: 30,
  codec: "h264",
  format: "mp4",
  videoBitrate: 10000,
  audioBitrate: 192,
  hardware: "auto",
  subtitleMode: "burn",
  exportSrt: false,
  outputDir: "",
};

export const DEFAULT_SETTINGS: AppSettings = {
  transcription: {
    provider: "none",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    language: "",
    whisperBinary: "",
    whisperModel: "",
  },
  llm: {
    provider: "heuristic",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    visionModel: "",
    useVision: false,
  },
  privacy: { allowCloud: false, keepTempFiles: false },
  processing: { gpu: "auto", concurrency: 1, autoProxy: true },
  clips: { minDuration: 15, maxDuration: 60, targetDuration: 30, maxClips: 12, adaptive: true },
  export: DEFAULT_EXPORT,
  subtitles: DEFAULT_SUBTITLE_STYLE,
  weights: { audio: 1, visual: 1, semantic: 1, chat: 1, game: 1, keyword: 1 },
  sources: { ytDlpPath: "" },
  appearance: { theme: "dark" },
};
