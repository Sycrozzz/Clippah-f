export class AppError extends Error {
  code: string;
  status: number;
  hint?: string;
  constructor(code: string, message: string, opts: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? 400;
    this.hint = opts.hint;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export function describeError(e: unknown): { message: string; code: string; hint?: string; status: number } {
  if (e instanceof AppError) return { message: e.message, code: e.code, hint: e.hint, status: e.status };
  const anyE = e as { code?: string; retryable?: boolean; message?: string; name?: string };
  if (anyE?.name === "AIError") return { message: anyE.message ?? "AI provider error", code: anyE.code ?? "ai_error", status: 502 };
  const msg = e instanceof Error ? e.message : String(e);
  return { message: msg, code: "internal", status: 500 };
}
