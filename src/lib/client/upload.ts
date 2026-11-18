"use client";

/** Streams a file to the server with progress (XHR gives upload progress events). */
export function uploadFile(file: File, projectId: number, onProgress: (f: number) => void, recording = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media/upload?projectId=${projectId}&name=${encodeURIComponent(file.name)}${recording ? "&recording=1" : ""}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("Network error during upload. Check that Clippahh is still running."));
    xhr.onload = () => {
      let body: { error?: string; hint?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.send(file);
  });
}

export const MEDIA_EXTS = [".mp4", ".m4v", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".flv", ".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"];

export function isMediaName(n: string): boolean {
  const i = n.lastIndexOf(".");
  return i >= 0 && MEDIA_EXTS.includes(n.slice(i).toLowerCase());
}

/** Recursively collect files from a drag-and-drop (supports dropping folders). */
export async function collectDropped(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  };
  const entries = Array.from(dt.items ?? [])
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e);
  else out.push(...Array.from(dt.files));
  return out;
}
