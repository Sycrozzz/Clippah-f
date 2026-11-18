export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureQueue } = await import("./lib/server/queue");
    // Resume any jobs interrupted by a previous shutdown/crash.
    ensureQueue().catch((e) => console.error("[clippahh] queue boot failed:", e instanceof Error ? e.message : e));
  }
}
