import type { Instrumentation } from "next";

/** Server errors from rendering, route handlers and actions, as one structured log line each. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("./lib/log");
  log.error("request.error", {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    digest: (err as { digest?: string }).digest,
    err,
  });
};
