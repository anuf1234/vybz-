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

  const key = await importPKCS8(config.privateKey.replace(/\\n/g, "\n"), "ES256");
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
