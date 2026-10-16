import "server-only";
import type { Actor } from "@vybz/core";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { getActor } from "../auth/server";
import { AppError, HTTP_STATUS, fieldErrors } from "../errors";
import { errorId, log } from "../log";
import { enforceRateLimit } from "../rate-limit";

/**
 * Every JSON route goes through here, so they all behave the same:
 *   - input parsed with zod (query string for GET, JSON body otherwise);
 *   - the signed-in actor loaded (and required, unless `auth: "optional"`);
 *   - an optional per-user (or per-IP for guests) rate limit;
 *   - errors as `{ error: { code, message, fields? } }` with the right status;
 *     unexpected errors are logged with an id and never leak details.
 */
type Ctx<P> = { req: Request; actor: Actor | null; params: P };

export function route<S extends z.ZodType, P = Record<string, string>>(
  opts: {
    input?: S;
    auth?: "required" | "optional";
    limit?: { name: string; max: number; windowMs: number };
  },
  handler: (ctx: Ctx<P> & { input: z.infer<S> }) => Promise<unknown>,
) {
  return async (req: Request, { params }: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const path = new URL(req.url).pathname;
    try {
      const actor = await getActor();
      if (opts.auth !== "optional" && !actor) throw new AppError("UNAUTHORIZED", "Sign in first.");
      if (opts.limit) {
        const who = actor?.id ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
        await enforceRateLimit(`${opts.limit.name}:${who}`, opts.limit.max, opts.limit.windowMs);
      }
      let input: unknown = undefined;
      if (opts.input) {
        const raw =
          req.method === "GET" || req.method === "HEAD"
            ? Object.fromEntries(new URL(req.url).searchParams)
            : await req.json().catch(() => {
                throw new AppError("INVALID", "Send a JSON body.");
              });
        input = opts.input.parse(raw);
      }
      const result = await handler({ req, actor, params: await params, input: input as z.infer<S> });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "INVALID", message: err.issues[0]?.message ?? "Invalid input.", fields: fieldErrors(err) } },
          { status: 400 },
        );
      }
      if (err instanceof AppError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, ...(err.fieldErrors ? { fields: err.fieldErrors } : {}) } },
          { status: HTTP_STATUS[err.code] },
        );
      }
      const id = errorId();
      log.error("api.unhandled", { id, path, method: req.method, ms: Date.now() - started, err });
      return NextResponse.json({ error: { code: "INTERNAL", message: `Something went wrong (ref ${id}).` } }, { status: 500 });
    }
  };
}
