import { ZodError } from "zod";

export type ErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT" | "RATE_LIMITED" | "UNAVAILABLE";

/**
 * An expected refusal with a message that is safe to show. Anything else that
 * escapes a handler is a bug: it is logged and the user sees a generic error.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

/** First message per field, for forms. */
export function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

export function invalid(err: ZodError): AppError {
  return new AppError("INVALID", err.issues[0]?.message ?? "That wasn't valid.", fieldErrors(err));
}
