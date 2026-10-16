# VYBZ

Competitive social music: song, playlist and DJ battles where the audience listens and votes round by round. Production domain: urexp.com.

The full architecture and roadmap live in [docs/architecture.md](docs/architecture.md).

## What's here so far

| Path | What it is |
|---|---|
| `packages/db` | Prisma schema and migrations (Postgres). Users, sessions, login accounts, verification tokens, rate limits. |
| `packages/core` | Framework-free domain rules: the `can()` authorization policy and profile validation (handles, display names, bios). |
| `packages/providers` | Provider abstraction. Apple Music adapter (catalog search, ISRC lookup, previews, MusicKit developer tokens), YouTube adapter (music search, embeddability), Apple→YouTube matcher, and per-viewer playback resolution with battle playback parity. |
| `apps/web` | Next.js app: sign-up and sign-in (email/password and Google), email verification, password reset, handle onboarding, public profiles at `/u/<handle>`, profile settings, and a catalog search page that plays Apple Music previews and YouTube embeds. |
| `packages/config` | Shared TypeScript config. |

### Music rules this code enforces

- Metadata (what a song is) is kept separate from playback (how a given viewer may hear it). Playback is resolved per request and never stored.
- No audio is downloaded, proxied or re-hosted. Apple previews and artwork load straight from Apple; YouTube plays only in its visible embedded player.
- Everyone can hear something without connecting an account: a YouTube embed or a 30-second Apple Music preview.

## Getting started

Requires Node 22, pnpm 10 and Postgres 16.

```bash
pnpm install
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=vybz -e POSTGRES_DB=vybz postgres:16
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env.local   # set BETTER_AUTH_SECRET, add provider keys
pnpm --filter @vybz/db migrate:deploy
pnpm dev                                       # http://localhost:3000
```

Without `RESEND_API_KEY`, verification and password-reset emails are printed to the terminal, so you can click the link from there. On the production deployment a missing key is an error instead.

### Sign-in

- **Email/password:** passwords of at least 10 characters, checked against known breaches (Have I Been Pwned). Accounts must confirm their email before they can sign in.
- **Google:** optional. Create an OAuth client ID (type Web) in Google Cloud, add `{BETTER_AUTH_URL}/api/auth/callback/google` as a redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The button appears once both are set.
- After first sign-in everyone picks a permanent @handle.
- Sessions live in Postgres and are checked on every request, so signing out, resetting a password or a ban takes effect immediately.

### Music provider keys

- **Apple Music:** an Apple Developer Program membership. Create a key with MusicKit enabled under Certificates, IDs & Profiles → Keys, then set `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID` and `APPLE_MUSIC_PRIVATE_KEY` (the .p8 contents).
- **YouTube:** a Google Cloud project with the YouTube Data API v3 enabled and an API key restricted to that API. The default quota is 10,000 units/day and each search costs 100, so results are cached.

The app runs with either provider alone. With both, Apple Music supplies metadata and each track can be matched to its YouTube video.

## Scripts

```bash
pnpm test        # unit tests; auth integration tests also run when DATABASE_URL is set
pnpm typecheck
pnpm build
```

CI runs everything against a Postgres 16 service, including migrations and a check that the schema and migrations agree.
