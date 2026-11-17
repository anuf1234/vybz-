import { SignJWT, importPKCS8 } from "jose";

export interface AppleMusicKeyConfig {
  teamId: string;
  keyId: string;
  /** Contents of the .p8 MusicKit private key (PKCS#8 PEM). `\n` escapes are accepted. */
  privateKey: string;
}

export interface DeveloperTokenOptions {
  /** Seconds until expiry. Apple allows up to ~6 months; we keep it short because the token reaches browsers. */
  ttlSeconds?: number;
  /** Restricts which web origins may use the token (Apple's `origin` claim). */
  origins?: string[];
  now?: Date;
}

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MAX_TTL_SECONDS = 180 * 24 * 60 * 60;

/** Signs an ES256 Apple Music developer token. Server-only: the key never leaves the server. */
export async function signDeveloperToken(
  config: AppleMusicKeyConfig,
  opts: DeveloperTokenOptions = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = Math.min(opts.ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = iat + ttl;

  const key = await importPKCS8(normalizePrivateKey(config.privateKey), "ES256");
  const claims = opts.origins?.length ? { origin: opts.origins } : {};

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);

  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Rebuilds a PEM from however the .p8 contents reached the environment: with
 * real or escaped (`\\n`) line breaks, line breaks turned into spaces by a
 * single-line input, Windows line endings, surrounding quotes, or only the
 * base64 body without the BEGIN/END lines.
 */
export function normalizePrivateKey(raw: string): string {
  let s = raw.trim().replace(/^["']|["']$/g, "").replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "");
  s = s.replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, " ");
  const body = s.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error("APPLE_MUSIC_PRIVATE_KEY is not a .p8 private key");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Caches one token per process and re-signs shortly before expiry, so we
 * don't sign on every request.
 */
export class DeveloperTokenCache {
  private current: { token: string; expiresAt: Date } | null = null;

  constructor(
    private readonly config: AppleMusicKeyConfig,
    private readonly opts: Omit<DeveloperTokenOptions, "now"> = {},
  ) {}

  async get(now = new Date()): Promise<string> {
    const refreshMarginMs = 10 * 60 * 1000;
    if (!this.current || this.current.expiresAt.getTime() - refreshMarginMs <= now.getTime()) {
      this.current = await signDeveloperToken(this.config, { ...this.opts, now });
    }
    return this.current.token;
  }
}
