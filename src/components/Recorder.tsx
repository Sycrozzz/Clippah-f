"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Icon, Notice, Toggle, ErrorBanner } from "./ui";
import { uploadFile } from "@/lib/client/upload";
import { errMsg, toast } from "@/lib/client/api";

type Mode = "screen" | "webcam" | "both";

export default function Recorder({ projectId, onSaved }: { projectId: number | null; onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>("screen");
  const [mic, setMic] = useState(true);
  const [sys, setSys] = useState(true);
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<(() => void)[]>([]);
  const liveRef = useRef<HTMLVideoElement>(null);

  useEffect(
    () => () => {
      cleanup.current.forEach((f) => f());
    },
    [],
  );

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const start = async () => {
    setErr(null);
    try {
      const streams: MediaStream[] = [];
      let display: MediaStream | null = null;
      let cam: MediaStream | null = null;
      if (mode !== "webcam") {
        display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: sys });
        streams.push(display);
      }
      if (mode !== "screen") {
        cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        streams.push(cam);
      }
      let micStream: MediaStream | null = null;
      if (mic) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.push(micStream);
      }
      cleanup.current.push(() => streams.forEach((s) => s.getTracks().forEach((t) => t.stop())));

      let videoTracks: MediaStreamTrack[];
      if (mode === "both" && display && cam) {
        const dv = document.createElement("video");
        const cv = document.createElement("video");
        dv.muted = cv.muted = true;
        dv.srcObject = new MediaStream(display.getVideoTracks());
        cv.srcObject = new MediaStream(cam.getVideoTracks());
        await Promise.all([dv.play(), cv.play()]);
        const canvas = document.createElement("canvas");
        canvas.width = dv.videoWidth || 1920;
        canvas.height = dv.videoHeight || 1080;
        const ctx = canvas.getContext("2d")!;
        const timer = setInterval(() => {
          ctx.drawImage(dv, 0, 0, canvas.width, canvas.height);
          const w = canvas.width * 0.22;
          const h = (w * (cv.videoHeight || 9)) / (cv.videoWidth || 16);
          const x = canvas.width - w - 24;
          const y = canvas.height - h - 24;
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,.5)";
          ctx.shadowBlur = 16;
          ctx.drawImage(cv, x, y, w, h);
          ctx.restore();
        }, 1000 / 30);
        cleanup.current.push(() => clearInterval(timer));
        videoTracks = canvas.captureStream(30).getVideoTracks();
      } else videoTracks = (display ?? cam)!.getVideoTracks();

      // mix system audio + microphone into one track
      const audioSources = [display, micStream].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
      let audioTracks: MediaStreamTrack[] = [];
      if (audioSources.length) {
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        audioSources.forEach((s) => ac.createMediaStreamSource(s).connect(dest));
        audioTracks = dest.stream.getAudioTracks();
        cleanup.current.push(() => void ac.close());
      } else if (sys && mode !== "webcam") toast("No system audio was shared. In the picker, choose a tab/screen and tick “Share audio”.", "info");

      const out = new MediaStream([...videoTracks, ...audioTracks]);
      if (liveRef.current) {
        liveRef.current.srcObject = out;
        void liveRef.current.play().catch(() => undefined);
      }
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        blobRef.current = blob;
        setBlobUrl(URL.createObjectURL(blob));
        setState("done");
        cleanup.current.forEach((f) => f());
        cleanup.current = [];
      };
      rec.onerror = () => setErr("The recorder reported an error and stopped.");
      display?.getVideoTracks()[0]?.addEventListener("ended", () => rec.state !== "inactive" && rec.stop());
      rec.start(1000);
      recRef.current = rec;
      setElapsed(0);
      const t0 = Date.now();
      const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500);
      cleanup.current.push(() => clearInterval(tick));
      setState("recording");
    } catch (e) {
      cleanup.current.forEach((f) => f());
      cleanup.current = [];
      const name = (e as Error)?.name;
      setErr(name === "NotAllowedError" ? "Permission was denied. Allow screen/camera/microphone access to record." : name === "NotFoundError" ? "No camera or microphone was found." : errMsg(e));
    }
  };

  const stop = () => recRef.current?.state !== "inactive" && recRef.current?.stop();

  const save = async () => {
    if (!blobRef.current || !projectId) return;
    setSaving(true);
    try {
      await uploadFile(new File([blobRef.current], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`, { type: "video/webm" }), projectId, () => undefined, true);
      toast("Recording saved to project", "success");
      setBlobUrl(null);
      blobRef.current = null;
      setState("idle");
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (!supported) return <Notice tone="warn">Recording needs a modern Chromium-based browser (Edge/Chrome) with MediaRecorder support.</Notice>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([["screen", "Screen", "screen"], ["webcam", "Webcam", "cam"], ["both", "Screen + webcam", "film"]] as const).map(([id, label, icon]) => (
          <button key={id} disabled={state === "recording"} onClick={() => setMode(id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${mode === id ? "border-accent bg-accent/10" : "border-line hover:border-accent/40"}`}>
            <Icon name={icon} /> {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle checked={mic} onChange={setMic} label="Microphone audio" />
        <Toggle checked={sys} onChange={setSys} label="System audio" hint="Browser-dependent: Chrome/Edge on Windows can share system or tab audio from the screen picker." />
      </div>
      <ErrorBanner message={err} onDismiss={() => setErr(null)} />
      <div className="overflow-hidden rounded-xl border border-line bg-black">
        {state === "done" && blobUrl ? (
          <video src={blobUrl} controls className="max-h-80 w-full" />
        ) : (
          <video ref={liveRef} muted className={`max-h-80 w-full ${state === "recording" ? "" : "hidden"}`} />
        )}
        {state === "idle" && <div className="flex h-40 items-center justify-center text-sm text-muted">Preview appears here while recording</div>}
      </div>
      <div className="flex items-center gap-3">
        {state !== "recording" ? (
          <Button variant="primary" onClick={start} disabled={!projectId}>
            <Icon name="play" /> {state === "done" ? "Record again" : "Start recording"}
          </Button>
        ) : (
          <Button variant="danger" onClick={stop}>
            <Icon name="stop" /> Stop · {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}
          </Button>
        )}
        {state === "done" && (
          <Button variant="success" onClick={save} disabled={saving || !projectId}>
            <Icon name="check" /> {saving ? "Saving…" : "Save to project"}
          </Button>
        )}
        {!projectId && <span className="text-xs text-muted">Select a project first.</span>}
      </div>
    </div>
  );
}
