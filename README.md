# VYBZ

Competitive social music: song, playlist and DJ battles where the audience listens and votes round by round. Production domain: urexp.com.

The full architecture and roadmap live in [docs/architecture.md](docs/architecture.md).

## What's here so far

| Path | What it is |
|---|---|
| `packages/db` | Prisma schema and migrations (Postgres). Users, sessions, login accounts, verification tokens, rate limits; tracks and provider refs; battles, rounds, picks, votes and listening progress. |
| `packages/core` | Framework-free domain rules: the `can()` authorization policy and profile validation (handles, display names, bios), and the song battle engine (rounds, deadlines, scoring, fair-listen rules) as pure functions. |
| `packages/providers` | Provider abstraction. Apple Music adapter (catalog search, ISRC lookup, previews, MusicKit developer tokens), YouTube adapter (music search, embeddability), Apple→YouTube matcher, a development-only sample catalog, and per-viewer playback resolution with battle playback parity. |
| `apps/web` | Next.js app: sign-up and sign-in (email/password and Google), email verification, password reset, handle onboarding, public profiles at `/u/<handle>`, profile settings, song battles at `/battles`, and a catalog search page that plays Apple Music previews and YouTube embeds. |
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

### Song battles

Two people battle over a theme (say, 2000s R&B) for 3, 5, 7 or 10 rounds. Each round both pick one track without seeing the other's pick, then the crowd votes.

- **Challenges:** open (anyone can accept) or direct to an @handle. Unaccepted challenges expire after 72 hours. Optional era limits are checked against Apple Music release years.
- **Pace:** quick (1 hour to pick, 1 to vote), standard (a day each) or relaxed (two days each). Missing the pick deadline forfeits the round to the side that picked.
- **Voting is blind and earned:** picks show as A and B (order varies per voter) until the round closes, battlers can't vote, and a vote only counts after the voter has heard 20 seconds of both tracks. The server caps listening credit by real elapsed time.
- **Winning:** most rounds wins. Level after the last round means one sudden-death round, then total votes.
- **Deadlines** are applied whenever anyone opens a battle or the list. `GET /api/cron/advance-battles` with `Authorization: Bearer $CRON_SECRET` sweeps the rest; point Vercel Cron or any scheduler at it.

Battles pick from Apple Music. Without Apple keys, set `MUSIC_FIXTURES=1` in development to use a sample catalog of 24 real songs with generated tones instead of audio. It never turns on in production or when an Apple key is set.

### Music provider keys

- **Apple Music:** an Apple Developer Program membership. Create a key with MusicKit enabled under Certificates, IDs & Profiles → Keys, then set `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID` and `APPLE_MUSIC_PRIVATE_KEY` (the .p8 contents).
- **YouTube:** a Google Cloud project with the YouTube Data API v3 enabled and an API key restricted to that API. The default quota is 10,000 units/day and each search costs 100, so results are cached.

The app runs with either provider alone. With both, Apple Music supplies metadata and each track can be matched to its YouTube video.

## Scripts

```bash
pnpm test        # unit tests; auth and battle integration tests also run when DATABASE_URL is set
pnpm typecheck
pnpm build
```

CI runs everything against a Postgres 16 service, including migrations and a check that the schema and migrations agree.
