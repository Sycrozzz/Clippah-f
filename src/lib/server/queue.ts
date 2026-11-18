import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import type { JobLogEntry, JobType } from "@/lib/shared/types";
import { CancelledError, describeError } from "./errors";
import { getSettings } from "./settings";
import { ensureDirs } from "./paths";

export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
  job: JobRow;
  signal: AbortSignal;
  update(p: { stage?: string; progress?: number; message?: string }): void;
  log(kind: JobLogEntry["kind"], msg: string): void;
  setResult(r: Record<string, unknown>): void;
}

type Handler = (ctx: JobContext) => Promise<void>;

const loaders: Record<JobType, () => Promise<Handler>> = {
  analysis: async () => (await import("./analysis/pipeline")).runAnalysisJob,
  export: async () => (await import("./export")).runExportJob,
  proxy: async () => (await import("./media")).runProxyJob,
  download: async () => (await import("./download")).runDownloadJob,
};

interface QueueState {
  running: Map<number, AbortController>;
  booted: boolean;
  kicking: boolean;
  again: boolean;
}

const g = globalThis as typeof globalThis & { __clippahhQueue?: QueueState };
function state(): QueueState {
  return (g.__clippahhQueue ??= { running: new Map(), booted: false, kicking: false, again: false });
}

/** Boot the queue once per process and recover jobs interrupted by a crash/restart. */
export async function ensureQueue(): Promise<void> {
  const s = state();
  if (s.booted) return;
  s.booted = true;
  ensureDirs();
  try {
    await db
      .update(jobs)
      .set({ status: "failed", error: "Interrupted too many times. Retry manually.", finishedAt: new Date() })
      .where(and(eq(jobs.status, "running"), sql`${jobs.attempts} >= 3`));
    await db
      .update(jobs)
      .set({ status: "queued", stage: "Recovered", message: "Resuming after an interruption…", progress: 0 })
      .where(and(eq(jobs.status, "running"), lt(jobs.attempts, 3)));
  } catch (e) {
    s.booted = false;
    throw e;
  }
  void kick();
}

export async function enqueueJob(input: {
  type: JobType;
  projectId?: number | null;
  mediaId?: number | null;
  clipId?: number | null;
  config?: Record<string, unknown>;
}): Promise<JobRow> {
  const [row] = await db
    .insert(jobs)
    .values({
      type: input.type,
      projectId: input.projectId ?? null,
      mediaId: input.mediaId ?? null,
      clipId: input.clipId ?? null,
      config: input.config ?? {},
    })
    .returning();
  await ensureQueue();
  void kick();
  return row;
}

export async function cancelJob(id: number): Promise<void> {
  const s = state();
  const ctrl = s.running.get(id);
  if (ctrl) {
    ctrl.abort();
    return;
  }
  await db
    .update(jobs)
    .set({ status: "cancelled", stage: "Cancelled", message: "Cancelled before start", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["queued", "running"])));
}

export async function retryJob(id: number): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "queued", stage: "Queued", progress: 0, error: null, message: "", attempts: 0, finishedAt: null, etaSeconds: null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])));
  await ensureQueue();
  void kick();
}

async function kick(): Promise<void> {
  const s = state();
  if (s.kicking) {
    s.again = true;
    return;
  }
  s.kicking = true;
  try {
    do {
      s.again = false;
      const settings = await getSettings();
      while (s.running.size < settings.processing.concurrency) {
        const [next] = await db.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.id)).limit(1);
        if (!next) break;
        const [claimed] = await db
          .update(jobs)
          .set({ status: "running", startedAt: new Date(), attempts: next.attempts + 1, stage: "Starting", progress: 0, error: null })
          .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
          .returning();
        if (claimed) launch(claimed);
      }
    } while (s.again);
  } catch (e) {
    console.error("[queue] kick failed", describeError(e).message);
  } finally {
    s.kicking = false;
  }
}

function launch(job: JobRow): void {
  const s = state();
  const controller = new AbortController();
  s.running.set(job.id, controller);
  const started = Date.now();
  const cur = { stage: job.stage, progress: 0, message: "" };
  let logs: JobLogEntry[] = [];
  let result: Record<string, unknown> = {};
  let lastWrite = 0;
  let writing = Promise.resolve();

  const flush = (extra: Partial<typeof jobs.$inferInsert> = {}) => {
    lastWrite = Date.now();
    const elapsed = (Date.now() - started) / 1000;
    const eta = cur.progress > 0.03 && cur.progress < 1 ? (elapsed * (1 - cur.progress)) / cur.progress : null;
    const values = { stage: cur.stage, progress: cur.progress, message: cur.message, etaSeconds: eta, logs: logs.slice(-300), result, ...extra };
    writing = writing.then(() => db.update(jobs).set(values).where(eq(jobs.id, job.id)).then(() => undefined)).catch(() => undefined);
    return writing;
  };

  const ctx: JobContext = {
    job,
    signal: controller.signal,
    update(p) {
      if (p.stage !== undefined) cur.stage = p.stage;
      if (p.progress !== undefined) cur.progress = Math.max(0, Math.min(1, p.progress));
      if (p.message !== undefined) cur.message = p.message;
      if (Date.now() - lastWrite > 600) void flush();
    },
    log(kind, msg) {
      logs.push({ t: Date.now(), kind, msg: msg.slice(0, 500) });
      if (logs.length > 400) logs = logs.slice(-300);
    },
    setResult(r) {
      result = { ...result, ...r };
    },
  };

  void (async () => {
    try {
      const handler = await loaders[job.type as JobType]();
      await handler(ctx);
      cur.progress = 1;
      cur.stage = "Completed";
      await flush({ status: "completed", finishedAt: new Date(), etaSeconds: null });
    } catch (e) {
      if (e instanceof CancelledError || controller.signal.aborted) {
        ctx.log("warn", "Cancelled by user");
        await flush({ status: "cancelled", stage: "Cancelled", finishedAt: new Date(), etaSeconds: null });
      } else {
        const d = describeError(e);
        ctx.log("error", d.message);
        await flush({ status: "failed", stage: "Failed", error: d.hint && d.code !== "ffmpeg_failed" ? `${d.message} ${d.hint}` : d.message, finishedAt: new Date(), etaSeconds: null });
      }
    } finally {
      s.running.delete(job.id);
      void kick();
    }
  })();
}
