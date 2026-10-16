import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { z } from "zod";

/**
 * Where user media lives. Browsers upload straight to storage with a
 * short-lived signed URL (serverless functions can't take large bodies), then
 * the server checks the stored object before marking the upload ready.
 *
 *  - Production: Cloudflare R2 (S3 API), private bucket, signed GETs.
 *  - Development: local disk under UPLOADS_DIR, served by our own routes
 *    with signed, expiring tokens. Never used on Vercel.
 */
export interface Storage {
  readonly kind: "r2" | "local";
  presignPut(key: string, contentType: string, uploadId: string): Promise<{ url: string; headers: Record<string, string> }>;
  head(key: string): Promise<{ size: number } | null>;
  /** First bytes of the object, for type sniffing. */
  readStart(key: string, bytes: number): Promise<Uint8Array>;
  playbackUrl(key: string, uploadId: string): Promise<string>;
  remove(key: string): Promise<void>;
}

const Env = z.object({
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  UPLOADS_DIR: z.string().min(1).optional(),
  UPLOAD_SIGNING_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  VERCEL: z.string().optional(),
});
const env = Env.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));

const SIGNED_URL_TTL_S = 15 * 60;
const PLAYBACK_TTL_S = 6 * 60 * 60;

class R2Storage implements Storage {
  readonly kind = "r2" as const;
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    this.base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  }

  private async sign(key: string, method: "PUT" | "GET", ttl: number, headers: Record<string, string> = {}) {
    const url = new URL(`${this.base}/${key}`);
    url.searchParams.set("X-Amz-Expires", String(ttl));
    const signed = await this.client.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
  }

  async presignPut(key: string, contentType: string) {
    const headers = { "content-type": contentType };
    return { url: await this.sign(key, "PUT", SIGNED_URL_TTL_S, headers), headers };
  }

  async head(key: string) {
    const res = await this.client.fetch(`${this.base}/${key}`, { method: "HEAD" });
    if (!res.ok) return null;
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async readStart(key: string, bytes: number) {
    const res = await this.client.fetch(`${this.base}/${key}`, { headers: { range: `bytes=0-${bytes - 1}` } });
    return new Uint8Array(await res.arrayBuffer());
  }

  playbackUrl(key: string) {
    return this.sign(key, "GET", PLAYBACK_TTL_S);
  }

  async remove(key: string) {
    await this.client.fetch(`${this.base}/${key}`, { method: "DELETE" });
  }
}

export class LocalStorage implements Storage {
  readonly kind = "local" as const;
  constructor(
    private readonly dir: string,
    private readonly secret: string,
  ) {}

  filePath(key: string): string {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  token(uploadId: string, purpose: "put" | "get", ttlS: number): string {
    const exp = Math.floor(Date.now() / 1000) + ttlS;
    const mac = createHmac("sha256", this.secret).update(`${purpose}:${uploadId}:${exp}`).digest("base64url");
    return `${exp}.${mac}`;
  }

  verify(uploadId: string, purpose: "put" | "get", token: string | null): boolean {
    const [exp, mac] = (token ?? "").split(".");
    if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
    const want = createHmac("sha256", this.secret).update(`${purpose}:${uploadId}:${exp}`).digest("base64url");
    return want.length === mac.length && timingSafeEqual(Buffer.from(want), Buffer.from(mac));
  }

  async presignPut(_key: string, contentType: string, uploadId: string) {
    return {
      url: `/api/uploads/${uploadId}/blob?token=${this.token(uploadId, "put", SIGNED_URL_TTL_S)}`,
      headers: { "content-type": contentType },
    };
  }

  async head(key: string) {
    try {
      return { size: (await stat(this.filePath(key))).size };
    } catch {
      return null;
    }
  }

  async readStart(key: string, bytes: number) {
    const fh = await open(this.filePath(key), "r");
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  }

  async playbackUrl(_key: string, uploadId: string) {
    return `/api/uploads/${uploadId}/blob?token=${this.token(uploadId, "get", PLAYBACK_TTL_S)}`;
  }

  async ensureDir(key: string) {
    await mkdir(path.dirname(this.filePath(key)), { recursive: true });
  }

  async remove(key: string) {
    await rm(this.filePath(key), { force: true });
  }
}

function build(): Storage | null {
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
    return new R2Storage(env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET);
  }
  // Local disk only off Vercel (its filesystem is read-only and per-instance).
  const secret = env.UPLOAD_SIGNING_SECRET ?? env.BETTER_AUTH_SECRET;
  if (!env.VERCEL && secret && secret.length >= 32) {
    // Local development only, so the path stays out of build tracing.
    return new LocalStorage(path.resolve(/* turbopackIgnore: true */ env.UPLOADS_DIR ?? ".uploads"), secret);
  }
  return null;
}

/** Null when no storage is configured: mix battles and avatars are then unavailable. */
export const storage = build();

export const UPLOAD_RULES = {
  MIX: {
    maxBytes: 200 * 1024 * 1024,
    types: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"],
  },
  AVATAR: {
    maxBytes: 5 * 1024 * 1024,
    types: ["image/jpeg", "image/png", "image/webp"],
  },
} as const;

/**
 * Checks the file's first bytes, not its claimed type, so a renamed
 * executable or HTML page can't be stored as "audio".
 */
export function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync (MP3) or ADTS (AAC: layer bits 00).
    return (b[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  if (ascii(4, 8) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Whether a sniffed type satisfies a declared one (m4a/mp4 and wav aliases). */
export function typeMatches(declared: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  const norm = (t: string) => ({ "audio/x-m4a": "audio/mp4", "audio/x-wav": "audio/wav" })[t] ?? t;
  return norm(declared) === norm(sniffed);
}
