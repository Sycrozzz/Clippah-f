-- Initial desktop database schema. Safe to run on every launch.
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  owns_file BOOLEAN NOT NULL DEFAULT TRUE,
  size_bytes DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  fps REAL NOT NULL DEFAULT 0,
  video_codec TEXT,
  audio_codec TEXT,
  container TEXT,
  bitrate DOUBLE PRECISION NOT NULL DEFAULT 0,
  has_video BOOLEAN NOT NULL DEFAULT TRUE,
  has_audio BOOLEAN NOT NULL DEFAULT TRUE,
  browser_playable BOOLEAN NOT NULL DEFAULT TRUE,
  proxy_path TEXT,
  thumb_path TEXT,
  chat_path TEXT,
  chat_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcripts (
  id SERIAL PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  segments JSONB NOT NULL,
  language TEXT,
  source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analyses (
  id SERIAL PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  job_id INTEGER,
  category TEXT NOT NULL,
  category_confidence REAL NOT NULL DEFAULT 0,
  category_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeline JSONB NOT NULL,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
  clip_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'Queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  eta_seconds REAL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clips (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  analysis_id INTEGER,
  title TEXT NOT NULL,
  start_sec DOUBLE PRECISION NOT NULL,
  end_sec DOUBLE PRECISION NOT NULL,
  peak_sec DOUBLE PRECISION,
  score REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'general',
  reason TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  rank INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ai',
  aspect TEXT NOT NULL DEFAULT '9:16',
  crop JSONB NOT NULL,
  audio JSONB NOT NULL,
  subtitles JSONB NOT NULL,
  thumb_path TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exports (
  id SERIAL PRIMARY KEY,
  clip_id INTEGER REFERENCES clips(id) ON DELETE SET NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id INTEGER,
  title TEXT NOT NULL,
  settings JSONB NOT NULL,
  file_path TEXT,
  srt_path TEXT,
  size_bytes DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
