# Clippahh

**AI-assisted video clipping.** Import long recordings, let a multi-signal analysis engine find the moments worth keeping, review and fine-tune them in an editor, then export platform-ready clips (9:16, 16:9, 1:1, 4:5, custom) with burned-in or separate subtitles.

Clippahh is a **local-first app**: a Next.js (React + TypeScript) UI and API running on your own machine, a PostgreSQL project database, and FFmpeg/FFprobe doing all media work. Your videos are processed locally and are never uploaded; only the data you explicitly authorise for a cloud AI provider (audio track, transcript text, optional frames) can leave the machine.

> **Build status — read this first.** The repository now includes an Electron desktop wrapper and a Windows GitHub Actions packaging workflow. The Windows installer and portable executable still need to be built and smoke-tested by running that workflow on a Windows runner. Packaging notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What works (and is tested)

| Area | Status |
|---|---|
| Import: files, many files, drag & drop, whole folders (browser), local path / folder import (referenced in place), direct media URLs | ✅ tested via real HTTP uploads |
| Formats: MP4 MOV MKV AVI WebM WMV FLV · MP3 WAV AAC M4A FLAC OGG; H.264/H.265/AV1/VP9, AAC/MP3/Opus (FFprobe detection, clear errors for corrupt/unsupported files) | ✅ corrupt + wrong-extension files tested; codec coverage depends on FFmpeg build |
| Metadata panel, thumbnails, automatic 720p preview proxy for browser-unfriendly formats | ✅ |
| Recording: screen, webcam, screen+webcam, mic, system audio (browser `MediaRecorder`) | ⚠️ implemented; needs a real browser/permissions, not covered by automated tests |
| Audio analysis: loudness vs. rolling baseline, brightness/spectral change, laughter-like pulsing, applause-like noise, sudden volume change, silence cut points | ✅ unit + FFmpeg integration tests (heuristic DSP, not a trained model) |
| Visual analysis: scene changes, action/motion bursts | ✅ tested |
| Speech recognition: any OpenAI-compatible `/audio/transcriptions` server (cloud or local) or **whisper.cpp** (fully local); `.srt` import | ✅ import path tested end-to-end; provider code follows the documented APIs but needs your key/model to exercise |
| Semantic analysis: OpenAI-compatible or Anthropic LLM (models fetched live from the provider — none hardcoded); built-in rule-based fallback | ✅ heuristic path tested end-to-end; LLM path needs your key |
| Vision review of top candidates (optional, vision-capable LLM) | ⚠️ implemented, needs your key |
| Chat analysis from an *exported/authorised* chat log (TwitchDownloader JSON, generic JSON, CSV, `[hh:mm:ss] user: msg`) — surges, emote spam | ✅ tested |
| Game events | ⚠️ **inferred** from speech cues + audio/motion peaks and labelled as such. Clippahh does **not** read kill feeds or game state. |
| Custom keywords / names / phrases (whole-word, accent/case-insensitive); always produce a clip | ✅ tested |
| Fusion scoring per content category, adjustable weights, anti-"just loud" rule, confidence, evidence, engagement *estimate* | ✅ tested |
| Adaptive clip boundaries (sentence/silence snapping), fixed-length mode, regenerate longer/shorter/re-snap | ✅ tested |
| Review UI: ranked cards, approve/reject, rename, duplicate, delete, preview render | ✅ |
| Editor: timeline heat-map with draggable trim handles, clip navigation, crop focus (drag on video), blur-fit, any aspect ratio, subtitle editor + styling, audio controls, autosave | ✅ API/export side tested; UI interactions verified by build + type-check only |
| Export: presets, codec/format/fps/bitrate/audio quality, NVENC with automatic CPU fallback, soft/burned subtitles, separate SRT, batch queue, verification of output duration | ✅ real FFmpeg tests incl. content/timestamp check |
| Queue: background jobs, progress + ETA, cancel, retry, automatic resume of interrupted jobs | ✅ cancel/retry/resume tested |
| Projects: create / rename / delete / reopen, processing history | ✅ |
| Settings: providers, models, encrypted API keys (AES-256-GCM), privacy gate, GPU, defaults, theme | ✅ |
| Platform links (YouTube/Twitch/Kick/TikTok/Instagram) | ⚠️ via optional **yt-dlp** only, for content you own/are permitted to use. Not exercised here (no yt-dlp/network). Clippahh never bypasses logins, DRM or access controls. |

## Install & run

### Requirements
* Node.js 20+ (22 recommended) and npm
* PostgreSQL 14+ (a local instance)
* FFmpeg/FFprobe — installed automatically through the `ffmpeg-static` / `ffprobe-static` packages. To use your own (e.g. a build with NVENC): set `FFMPEG_PATH` / `FFPROBE_PATH`.

### Steps (Windows 11 or any OS)
```bash
git clone <this repo> clippahh && cd clippahh
npm install
cp .env.example .env            # Windows: copy .env.example .env  — then edit DATABASE_URL
npx drizzle-kit push            # creates the tables
npm run build
npm run start                   # open http://localhost:3000
```
On Windows you can instead double-click `scripts/start-windows.bat` (does the same; **not tested on Windows in this environment**).

Create a database first, e.g. `createdb clippahh`, and put its URL in `.env`.

### GPU acceleration
If an NVIDIA GPU with NVENC is available to the FFmpeg you use, Clippahh detects it automatically (it test-encodes a frame) and uses `h264_nvenc` / `hevc_nvenc`. If a GPU encode fails it retries on CPU and logs a warning. The bundled static FFmpeg usually has no NVENC; point `FFMPEG_PATH` at a full build to enable it.

## User guide

1. **Create a project** (Dashboard → New project) and **import** media (Import Media). Use *Local path* for huge recordings to avoid copying.
2. *(Optional but recommended)* configure **Settings → AI providers**:
   * *Speech recognition*: an OpenAI-compatible endpoint (OpenAI, Groq, or a local server such as faster-whisper-server) or a local **whisper.cpp** binary + model. Or skip it and **Attach .srt** to a media card.
   * *Semantic AI*: any OpenAI-compatible chat model (Ollama/LM Studio for fully local), or Anthropic. Click **Fetch list** to see the models your provider currently offers. With no provider, a rule-based analyzer is used.
   * **Privacy**: remote providers are blocked until you tick *Allow sending data to cloud AI providers*. Local URLs (localhost) are always allowed.
3. Click **Analyze** on a media card. Optionally add keywords, choose a category, set min/max duration, adjust signal weights, or attach a chat log first. Watch progress and detected events on **AI Analysis**; cancel any time.
4. Review **Highlights**: each card shows score, category, duration, timestamps, the reason, evidence and confidence. Approve/reject, rename, duplicate, regenerate boundaries.
5. Open the **Editor** for any clip: trim on the timeline (drag handles, `I`/`O`, `Space`, arrows), choose aspect ratio and crop focus, edit subtitles and style, set audio fades/normalisation. Changes autosave. **Render preview** shows exactly what the export will look like.
6. **Export Manager**: pick clips, choose a preset or custom settings, export in a batch. Files land in the managed exports folder or your chosen output folder; download from the history.

Scores are **estimates from detected signals**; Clippahh does not predict or guarantee viral performance.

## Configuration

See `.env.example`. Secrets: API keys entered in Settings are stored encrypted in the database (AES-256-GCM); the master key is read from `CLIPPAHH_SECRET` or generated into `data/.secret` (mode 600). On Windows, supply `CLIPPAHH_SECRET` from a Credential-Manager-backed launcher if you need OS-level protection — a native Windows Credential Manager integration is **not** included.

## Testing

```bash
npx vitest run          # unit + FFmpeg integration tests (≈20 s)
```
Integration tests generate their own videos with FFmpeg and verify probing, corrupt-file errors, cancel, audio/visual analysis (incl. a 10-minute recording), and that exported clips have the right size, duration, aspect ratio, subtitles and *content* for the requested timestamps.

## Limitations

* **Windows binaries have not yet been produced or smoke-tested in this environment.** Use the Windows desktop release workflow to generate the NSIS installer and portable executable. The workflow does not code-sign the executables, so Windows SmartScreen may show an unknown-publisher warning.
* No Windows Credential Manager integration (keys are encrypted at rest in the app database instead).
* Laughter/applause/excitement detectors are signal-processing heuristics, not trained classifiers. Facial-expression detection is only available through the optional vision LLM review of up to 8 frames per analysis — there is no local face model.
* Game-event detection is inferred; no game-state or kill-feed reading.
* Twitch/Kick chat comes from files you export; live chat capture is not implemented. Platform downloads depend on yt-dlp.
* Subtitle burn-in uses libass; fonts must exist on the exporting machine (a fallback font is used otherwise).
* Recorder behaviour (system audio especially) depends on the browser.
* Local project storage is PostgreSQL rather than SQLite (platform requirement of this build).

## Windows desktop builds

The repository includes an Electron desktop wrapper and a GitHub Actions release workflow. The desktop build bundles the Next.js standalone server, FFmpeg dependencies, and a portable PostgreSQL 16 runtime. On first launch, PostgreSQL initializes a database inside the current Windows user's Clippahh data directory; the application schema is applied automatically. Media, exports, database files, and settings remain local to that machine.

### Build locally on Windows

A Windows build requires Node.js 22 and the PostgreSQL 16.4 Windows x64 binary archive. From PowerShell:

```powershell
npm install
npm run build
npm run desktop:prepare
# Download/extract PostgreSQL 16.4 binaries into desktop\postgres (so desktop\postgres\bin\initdb.exe exists)
npm run desktop:dist
```

The output is written to `dist/`: a normal NSIS installer (`Clippahh-Setup.exe`) and a portable executable (`Clippahh-*-Portable.exe`). The portable build keeps its writable data beside the portable executable in `Clippahh-data`; the installed build uses the normal Windows user data directory.

### Build with GitHub Actions

Push a version tag such as `v1.0.0` to create a GitHub Release, or run **Actions → Windows desktop release → Run workflow** to build downloadable artifacts without publishing a release. The workflow builds on a Windows runner, downloads the PostgreSQL runtime, and uploads both `.exe` files.

The desktop workflow is a Windows packaging pipeline; it does not sign the executables. Windows SmartScreen may show an unknown-publisher warning until you configure code signing.
