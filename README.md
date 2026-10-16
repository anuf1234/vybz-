# VYBZ

Competitive social music: song, playlist and DJ battles where the audience listens and votes round by round. Production domain: urexp.com.

The full architecture and roadmap live in [docs/architecture.md](docs/architecture.md).

## What's here so far

| Path | What it is |
|---|---|
| `packages/db` | Prisma schema and migrations (Postgres): users, profiles, accounts, sessions; music connections, tracks and provider refs, playlists; battles, participants, rounds, submissions, votes, listening progress and an event log; comments, reactions, follows, notifications; XP ledger, badges; uploads. Database CHECK and unique constraints back the important rules. |
| `packages/core` | Framework-free domain rules: the `can()` authorization policy, profile validation, and the battle engine (types, states, deadlines, reveals, tally, fair-listen credit) as pure functions. |
| `packages/providers` | Provider abstraction. Apple Music adapter (catalog search, ISRC lookup, previews, MusicKit developer tokens), YouTube adapter (music search, embeddability), Apple→YouTube matcher, a development-only sample catalog, and per-viewer playback resolution with battle playback parity. |
| `apps/web` | Next.js app. Pages: `/`, `/login`, `/signup`, `/onboarding`, `/discover`, `/battle` (vote now + open challenges), `/battle/create` (Quick Battle), `/battle/[id]`, `/battle/[id]/results`, `/battles/my`, `/profile/[username]`, `/settings`, `/notifications`. Server actions and API routes for battles, voting, comments, reactions, follows and uploads; JSON logging; DB-backed rate limits. |
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
- After first sign-in everyone picks a permanent @username (their profile lives at `/profile/<username>`).
- Sessions live in Postgres and are checked on every request, so signing out, resetting a password or a ban takes effect immediately.

### Battles

Tap **+ Battle** anywhere: pick who (a friend, a matched opponent, or an open challenge anyone can accept), a theme (90s R&B, Cookout Classics… or your own), 5/10/20 rounds, and your songs. That's a challenge. More options cover playlist and DJ-mix battles, era limits, privacy, voting length, round-by-round premieres and hidden vote counts.

- **Lifecycle:** challenge sent → accepted → opponent picks → (optional premiere) → voting → completed, with expiry, decline, withdraw and missed-pick cancellations. See `docs/architecture.md` §6.2.
- **Voting happens on the server:** one vote per person per round (database unique key), players can't vote, a voter must have played 10 seconds of both sides (credit capped by real elapsed time across the whole battle, so parallel or replayed listens don't count), and counts come only from stored votes.
- **Results** (round winners, final score, crowd favourite, total voters) are computed once when voting closes and stored. Rematch, share and follow live on the results page.
- **Deadlines** are applied whenever anyone opens a battle or their list; `GET /api/cron/advance-battles` with `Authorization: Bearer $CRON_SECRET` sweeps the rest.

Songs come from Apple Music. Without Apple keys, set `MUSIC_FIXTURES=1` in development to use a sample catalog of 24 real songs with generated tones instead of audio. It never turns on in production or when an Apple key is set.

### Sample data

```bash
pnpm --filter @vybz/web db:seed          # needs MUSIC_FIXTURES=1 to hear the tracks
pnpm --filter @vybz/web db:seed --reset  # wipe app data first (refuses to run in production)
```

Log in as `marcus`, `nia`, `dj_kay`, `fan` or `tasha` at `@example.com` with password `vybz-demo-pass`. You get a finished battle, a live one, Marcus's open "90s R&B playlist" challenge and a challenge waiting on Marcus.

### Music provider keys

- **Apple Music:** an Apple Developer Program membership. Create a key with MusicKit enabled under Certificates, IDs & Profiles → Keys, then set `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID` and `APPLE_MUSIC_PRIVATE_KEY` (the .p8 contents).
- **YouTube:** a Google Cloud project with the YouTube Data API v3 enabled and an API key restricted to that API. The default quota is 10,000 units/day and each search costs 100, so results are cached.

The app runs with either provider alone. With both, Apple Music supplies metadata and each track can be matched to its YouTube video.

## Scripts

```bash
pnpm lint
pnpm typecheck
pnpm test        # unit tests; auth and battle integration tests also run when DATABASE_URL is set
pnpm build
```

CI runs everything against a Postgres 16 service, including migrations and a check that the schema and migrations agree.
