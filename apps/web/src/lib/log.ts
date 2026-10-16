/**
 * Structured logging: one JSON object per line on stdout/stderr, which Vercel
 * (and most log drains) index by field. Never log secrets, tokens, passwords
 * or email bodies; pass ids instead.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 8).join("\n") };
  }
  return { message: String(err) };
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (ORDER[level] < threshold) return;
  const { err, ...rest } = fields;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...rest,
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function make(base: Fields): Logger {
  return {
    debug: (m, f) => write("debug", m, { ...base, ...f }),
    info: (m, f) => write("info", m, { ...base, ...f }),
    warn: (m, f) => write("warn", m, { ...base, ...f }),
    error: (m, f) => write("error", m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log = make({ app: "vybz-web" });

/** Short id to correlate a user-facing error with its log line. */
export function errorId(): string {
  return Math.random().toString(36).slice(2, 10);
}
