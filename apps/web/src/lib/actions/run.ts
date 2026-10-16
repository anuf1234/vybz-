import "server-only";
import { ZodError } from "zod";
import { AppError, fieldErrors } from "../errors";
import { errorId, log } from "../log";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

/**
 * Runs a server action body and turns refusals into a result the form can
 * show. Unexpected errors are logged with an id; the user sees only the id.
 * Next.js redirects and not-found signals pass straight through.
 */
export async function run<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, error: err.message, code: err.code, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) };
    }
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "That wasn't valid.", code: "INVALID", fieldErrors: fieldErrors(err) };
    }
    if (isNextSignal(err)) throw err;
    const id = errorId();
    log.error("action.unhandled", { id, action: name, err });
    return { ok: false, error: `Something went wrong. Try again (ref ${id}).`, code: "INTERNAL" };
  }
}

function isNextSignal(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}
