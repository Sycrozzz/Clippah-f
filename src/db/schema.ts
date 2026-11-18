import { pgTable, serial, text, integer, real, timestamp, jsonb, boolean, doublePrecision } from "drizzle-orm/pg-core";
import type {
  AnalysisConfig,
  AudioSettings,
  Category,
  ClipScores,
  ClipSubtitles,
  CropSettings,
  Cue,
  Evidence,
  ExportSettings,
  JobLogEntry,
  Signal,
  Timeline,
} from "@/lib/shared/types";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  ownsFile: boolean("owns_file").notNull().default(true),
  sizeBytes: doublePrecision("size_bytes").notNull().default(0),
  duration: real("duration").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  fps: real("fps").notNull().default(0),
  videoCodec: text("video_codec"),
  audioCodec: text("audio_codec"),
  container: text("container"),
  bitrate: doublePrecision("bitrate").notNull().default(0),
  hasVideo: boolean("has_video").notNull().default(true),
  hasAudio: boolean("has_audio").notNull().default(true),
  browserPlayable: boolean("browser_playable").notNull().default(true),
  proxyPath: text("proxy_path"),
  thumbPath: text("thumb_path"),
  chatPath: text("chat_path"),
  chatCount: integer("chat_count").notNull().default(0),
  sourceType: text("source_type").notNull().default("upload"),
  sourceUrl: text("source_url"),
  status: text("status").notNull().default("ready"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transcripts = pgTable("transcripts", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  segments: jsonb("segments").$type<Cue[]>().notNull(),
  language: text("language"),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  jobId: integer("job_id"),
  category: text("category").$type<Category>().notNull(),
  categoryConfidence: real("category_confidence").notNull().default(0),
  categoryScores: jsonb("category_scores").$type<Record<string, number>>().notNull().default({}),
  timeline: jsonb("timeline").$type<Timeline>().notNull(),
  signals: jsonb("signals").$type<Signal[]>().notNull().default([]),
  config: jsonb("config").$type<AnalysisConfig>().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  mediaId: integer("media_id").references(() => media.id, { onDelete: "cascade" }),
  clipId: integer("clip_id"),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("Queued"),
  progress: real("progress").notNull().default(0),
  message: text("message").notNull().default(""),
  error: text("error"),
  etaSeconds: real("eta_seconds"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  logs: jsonb("logs").$type<JobLogEntry[]>().notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export const clips = pgTable("clips", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  analysisId: integer("analysis_id"),
  title: text("title").notNull(),
  startSec: doublePrecision("start_sec").notNull(),
  endSec: doublePrecision("end_sec").notNull(),
  peakSec: doublePrecision("peak_sec"),
  score: real("score").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  category: text("category").$type<Category>().notNull().default("general"),
  reason: text("reason").notNull().default(""),
  evidence: jsonb("evidence").$type<Evidence[]>().notNull().default([]),
  scores: jsonb("scores").$type<ClipScores | null>(),
  status: text("status").notNull().default("pending"),
  rank: integer("rank").notNull().default(0),
  source: text("source").notNull().default("ai"),
  aspect: text("aspect").notNull().default("9:16"),
  crop: jsonb("crop").$type<CropSettings>().notNull(),
  audio: jsonb("audio").$type<AudioSettings>().notNull(),
  subtitles: jsonb("subtitles").$type<ClipSubtitles>().notNull(),
  thumbPath: text("thumb_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const exportsTable = pgTable("exports", {
  id: serial("id").primaryKey(),
  clipId: integer("clip_id").references(() => clips.id, { onDelete: "set null" }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  jobId: integer("job_id"),
  title: text("title").notNull(),
  settings: jsonb("settings").$type<ExportSettings>().notNull(),
  filePath: text("file_path"),
  srtPath: text("srt_path"),
  sizeBytes: doublePrecision("size_bytes").notNull().default(0),
  durationSec: real("duration_sec").notNull().default(0),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
