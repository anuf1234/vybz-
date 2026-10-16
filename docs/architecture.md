# VYBZ — Production Architecture & Implementation Plan

**Status:** Draft v1.1. Launch providers set to **YouTube and Apple Music** (Baba, 2026-10-15). Spotify is deferred.
**Date:** 2026-10-15
**Domain:** urexp.com

---

## 0. Summary and assumptions

### Key decisions at a glance

| Concern | Decision | Why |
|---|---|---|
| App framework | **Next.js (App Router) + React + TypeScript + Tailwind** | Matches your preference. Server Components and Server Actions cover most backend needs. |
| Backend shape | **Modular monolith inside Next.js**, plus **durable background jobs (Inngest)** and **one small media worker container** | Battle timers and audio processing need work that outlives a request. A separate Node API is not justified until Live DJ battles. |
| Repo layout | **pnpm + Turborepo monorepo** (`apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/providers`, `packages/ui`) | Keeps battle rules and provider logic as pure, testable TypeScript, independent of Next.js. |
| Database | **PostgreSQL on Neon**, **Prisma** ORM | Serverless-friendly pooling, a database branch per preview deploy, point-in-time recovery. |
| Cache / rate limits / live tallies | **Upstash Redis** | HTTP-based, works from serverless and edge. |
| Auth | **Better Auth** (Prisma adapter, database sessions) | Email/password, Google now and Apple later as plugins. User table stays in our Postgres. Built-in rate limiting and 2FA. |
| Realtime | **Ably** behind a `RealtimeBus` interface | Managed WebSockets with presence, history, and server-issued, capability-scoped tokens. The server publishes and clients only subscribe. |
| Object storage | **Cloudflare R2**, served at `media.urexp.com` | S3-compatible, no egress fees (audio is egress-heavy), presigned uploads. |
| Media processing | **ffmpeg + audiowaveform** in a worker on Fly.io, triggered by Inngest | Transcoding and waveform generation need native binaries and long run times. |
| Hosting | **Vercel** (web), Neon, Upstash, Ably, R2, Inngest, Fly.io (worker) | Each piece is managed. Nothing to patch at the OS level except the worker image. |
| Email | **Resend** | Verification, password reset, battle notifications. |
| Bot defense | **Cloudflare Turnstile** | Invisible challenge on sign-up, voting bursts, and battle creation. |
| Launch music providers | **Apple Music** (metadata with ISRC, 30s previews for everyone, full tracks for subscribers via MusicKit) + **YouTube** (visible embedded player for everyone) | Together they give every listener, with or without an account, something real to hear. Spotify is deferred. |
| Observability | **Sentry** (errors and traces), **PostHog** (product analytics and feature flags), Vercel logs | Feature flags gate phased rollout of battle types. |

### Assumptions (please correct any that are wrong)

1. **The existing prototype has not been shared.** This plan does not depend on it. When you share it (repo, Figma, or screenshots), it will be used for UX flows and naming, not for code reuse.
2. Launch is **web first, mobile-first responsive, installable as a PWA**. Native apps come later (Phase 6).
3. Minimum age is **13+** (16+ in the EU/UK), confirmed at sign-up. A legal review will set the final rule.
4. Monetization is out of scope for v1. The schema leaves room for subscriptions later.
5. `urexp.com` is the production domain even though the brand is VYBZ.

### The most important risk: music rights

The provider terms below shape the product more than any technical choice. Before building any battle type on a given provider, **a legal review of that provider's current developer terms is required**. In particular:

- **Spotify:** Recent Developer Policy versions restrict using Spotify content in **games and trivia**, and restrict synchronizing or overlaying Spotify audio. Since late 2024, new apps get no 30-second `preview_url`. Extended API quota (beyond 25 development users) has been limited to established businesses with large user bases. **Plan for Spotify as optional enhancement, never as the backbone.**
- **YouTube:** IFrame player only. The player must stay visible, ads can't be blocked, and there is no audio-only extraction.
- **Apple Music:** MusicKit gives full playback to subscribers and catalog previews to everyone, with attribution and linking rules.
- **DJ mixes** of commercial tracks are the hardest case. Hosting them ourselves needs licenses (in the US, PRO blanket licenses plus sound-recording rights). Mixcloud and SoundCloud embeds rely on their own licenses.

This is why the provider layer (Section 5) treats **metadata** and **playback rights** as separate concerns resolved per viewer, and why the app still works when nobody connects Spotify.

---

## 1. Product architecture

### 1.1 Personas

| Persona | Wants | Primary surfaces |
|---|---|---|
| **Fan / voter** | Hear good music, judge, feel heard | Discover, battle viewer, voting, feed |
| **Taste challenger** | Prove their taste ("nobody beats my 2000s R&B") | Create battle, song/playlist battles, rematch, share |
| **Curator** | Grow an audience for playlists | Playlist battles, rankings, profile |
| **DJ / mixer / creator** | Showcase skill, get booked | DJ Mix battles, DJ Studio, uploads, creator profile |
| **Moderator / admin** | Keep battles fair and legal | Moderation queue, fraud dashboard, rights takedowns |

### 1.2 Core loop mapped to features

```
DISCOVER ─▶ LISTEN ─▶ BATTLE ─▶ VOTE ─▶ WIN/LOSE ─▶ SHARE ─▶ REMATCH
   │          │          │        │         │           │          │
 Feed,     Unified    Challenge  Round    Result     OG share   One tap
 Trending, player     flow,      voting,  screen,    cards,     "Run it
 Search,   (per-viewer accept/   fair-    XP, rating deep links back" with
 Follows   playback)  submit     listen   change     to battle  same
                                 gate                            format
```

Retention loops plug into the result moment: XP and badges are awarded there, rankings update there, and the next daily challenge or tournament match is offered there.

### 1.3 Domains (bounded contexts)

Each domain is a folder of server code with its own service, policy, and data-access functions. Domains talk through function calls and domain events, never by reaching into each other's tables.

| Domain | Owns |
|---|---|
| **Identity** | Users, sessions, roles, auth accounts, trust score |
| **Social** | Profiles, follows, feed, comments, notifications |
| **Catalog** | Canonical tracks/artists, provider references, playlists |
| **Playback** | Provider connections, playback resolution per viewer, listen tracking |
| **Media** | Uploads, transcoding, waveforms, fingerprinting, rights declarations |
| **Battles** | Battles, rounds, submissions, votes, scoring, state machine |
| **Competition** | Ratings, seasons, rankings, tournaments, challenges |
| **Progression** | XP ledger, levels, badges, streaks |
| **Trivia** (later) | Questions, sessions, scores |
| **Learning** (later) | DJ University courses and lessons |
| **Trust & Safety** | Reports, moderation actions, fraud signals, rights claims (DMCA) |

### 1.4 Information architecture (mobile-first)

Bottom tab bar with five items:

1. **Home**: personalized feed, live now, trending battles, daily challenge card.
2. **Battles**: open challenges to accept, my active battles, battles awaiting my vote.
3. **Create (+)**: start a battle (Song / Playlist / DJ Mix) or answer a challenge.
4. **Rankings**: leaderboards by battle type, genre, region, season.
5. **Profile**: stats, record (W-L), badges, XP, playlists, mixes, followers.

A **persistent mini-player** sits above the tab bar. Desktop uses a left rail and a wider battle stage.

### 1.5 Key screens

- **Battle stage** (the signature screen): split VS layout with both sides' album art, a round tracker ("Round 4 / 10"), a sports-style scoreboard with rounds won, a waveform scrubber for hosted audio, and a vote button that stays disabled until the fair-listen requirement is met.
- **Round reveal**: sequential reveal, vote share bar, winner flourish (motion, not glow).
- **Result**: final score, rating change (+18), XP earned, badges, Share and Rematch.
- **Create battle wizard**: type, theme ("2000s R&B"), rounds, timing (async or scheduled live), opponent (open challenge, a specific user, or a friend link), rules (blind voting, era/genre constraints).
- **Submission picker**: unified search across the catalog. Each result shows playback availability badges ("Full on Spotify", "Preview", "Video").

### 1.6 Design system direction

- **Tokens:** background `#0B0614` (near-black purple), surface steps, primary **deep purple** `#2A0E4F`, accent **electric violet** `#8B5CF6`, and **one neon accent** (e.g. `#39FF88` or cyan) reserved for *live* state and *winner* state only. Semantic tokens (`--color-live`, `--color-win`, `--color-lose`) stop glow from spreading across the UI.
- **Rule of restraint:** glow and neon appear only on live indicators, the active vote, and the winner reveal. Everything else uses flat surfaces, album art color extraction (dominant color tints the battle stage), and typography.
- **Type:** a condensed, athletic display face for scoreboards and round numbers, paired with a clean grotesk for UI.
- **Motion:** 150–250 ms ease-out transitions. Score ticks animate. Respects `prefers-reduced-motion`.
- **Components:** headless primitives (Radix) styled with Tailwind, in `packages/ui`, previewed in Storybook.

---

## 2. Technical architecture

### 2.1 System diagram

```
                      ┌────────────────────────── Vercel ───────────────────────────┐
 Browser / PWA ─────▶ │ Next.js app (apps/web)                                      │
  │  ▲                │  • RSC pages, Server Actions, Route Handlers (/api/*)       │
  │  │                │  • Better Auth handlers (/api/auth/*)                       │
  │  │                │  • Domain services (packages/core) + Prisma (packages/db)   │
  │  │                └───────┬───────────┬─────────────┬──────────────┬────────────┘
  │  │                        │           │             │              │
  │  │                   Neon Postgres  Upstash      Inngest        Ably REST
  │  │                   (source of     Redis        (durable       (publish
  │  │                    truth)        (limits,     jobs, timers,   events)
  │  │                                  tallies)     outbox relay)     │
  │  │                                                   │             │
  │  └────── Ably WebSocket (subscribe only) ◀───────────┼─────────────┘
  │                                                      ▼
  │                                           Media worker (Fly.io)
  │                                           ffmpeg, audiowaveform,
  │                                           fingerprint API calls
  │                                                      │
  └── presigned PUT/GET ─────────────▶ Cloudflare R2 ◀───┘
                                       (media.urexp.com)

 Third parties: Google OAuth, (Apple later), Spotify Web API + Web Playback SDK,
 Apple MusicKit, YouTube Data API + IFrame, Mixcloud/SoundCloud embeds,
 MusicBrainz, ACRCloud/Audible Magic (fingerprinting), Resend, Turnstile, Sentry, PostHog
```

### 2.2 Why no dedicated Node backend (yet)

- Request/response work (CRUD, voting, submissions) fits Route Handlers and Server Actions.
- The things serverless handles badly are covered elsewhere: **timers** (round deadlines) go to Inngest, **long CPU work** (transcoding) goes to the worker, and **persistent sockets** go to Ably.
- **Revisit** when building Live DJ battles (Phase 5). At that point a stateful room service (or LiveKit for audio) is warranted.

### 2.3 Code organization

```
apps/
  web/            Next.js app: routes, UI, server actions, API route handlers
  worker/         Node service: media jobs (ffmpeg, waveforms), receives Inngest calls
packages/
  core/           Pure domain logic: battle state machine, scoring, ratings, XP rules,
                  authorization policies. No framework imports. Heavily unit-tested.
  db/             Prisma schema, migrations, generated client, data-access helpers
  providers/      MusicProvider adapters (Spotify, Apple, YouTube, Upload, Original, ...)
  realtime/       RealtimeBus interface + Ably implementation
  ui/             Design tokens, Tailwind preset, components
  config/         Shared ESLint, TS, Tailwind configs
```

### 2.4 Request handling conventions

- **Every mutation** goes through: `validate input (Zod)` → `load session` → `authorize (core policy)` → `domain service in a DB transaction` → `write outbox event` → `return`.
- **Reads** in Server Components call the data-access layer, which applies visibility rules (private battles, banned users, blocked content).
- **Public API** (`/api/v1/*`) exists only where needed: mobile apps later, webhooks, OG image routes. Versioned from day one.

### 2.5 Background jobs (Inngest)

| Job | Trigger |
|---|---|
| `battle.round.open` / `battle.round.close` | Scheduled at round deadlines (durable `sleepUntil`) |
| `battle.finalize` | Last round closed: final tally, fraud check, ratings, XP, badges |
| `outbox.relay` | New outbox rows: publish to Ably, fan out notifications |
| `media.process` | Upload completed: transcode, waveform, fingerprint, then mark ready |
| `provider.token.refresh` | Before expiry of a connected provider token |
| `feed.fanout` | Activity created: write to followers' feeds (or read-time merge at small scale) |
| `fraud.scan` | Round closed: anomaly detection on votes |
| `challenge.daily.rotate` | Cron at 00:00 UTC |
| `ratings.season.rollover` | Cron at season end |

---

## 3. Database schema

PostgreSQL via Prisma. Conventions: `cuid2` string IDs, `createdAt`/`updatedAt` on every table, soft delete (`deletedAt`) for user content, `citext` for handles and emails, enums for states. Below is the core schema in condensed Prisma form. Indexes and some fields are abbreviated.

### 3.1 Identity and social

```prisma
enum Role       { USER CREATOR MODERATOR ADMIN }   // "guest" = no session
enum UserStatus { ACTIVE SUSPENDED BANNED DELETED }

model User {
  id             String     @id @default(cuid())
  email          String     @unique            // citext
  emailVerified  Boolean    @default(false)
  handle         String     @unique            // citext, 3–20 chars
  displayName    String
  avatarAssetId  String?
  bio            String?
  role           Role       @default(USER)
  status         UserStatus @default(ACTIVE)
  trustScore     Int        @default(50)       // 0–100, drives vote weight eligibility
  birthYear      Int?
  twoFactorOn    Boolean    @default(false)
  // relations: accounts, sessions, providerConnections, battles, votes, xp, badges...
}

model Session {           // Better Auth: DB-backed sessions
  id String @id; userId String; token String @unique  // stored hashed
  expiresAt DateTime; ipHash String?; userAgent String?
}

model Account {           // Better Auth: login identities (credential, google, apple)
  id String @id; userId String; providerId String; accountId String
  passwordHash String?   // only for providerId = "credential"
  @@unique([providerId, accountId])
}

model Verification { id String @id; identifier String; value String; expiresAt DateTime }

model Follow   { followerId String; followeeId String; createdAt DateTime
                 @@id([followerId, followeeId]) }
model Block    { blockerId String; blockedId String; @@id([blockerId, blockedId]) }

model Activity {          // feed source events
  id String @id; actorId String; type ActivityType; subjectType String; subjectId String
  createdAt DateTime; @@index([actorId, createdAt])
}
model Notification { id String @id; userId String; type String; payload Json; readAt DateTime? }
model Comment      { id String @id; authorId String; battleId String; roundId String?
                     body String; deletedAt DateTime? }
```

### 3.2 Catalog and playback (metadata separate from rights)

```prisma
enum ProviderKind { SPOTIFY APPLE_MUSIC YOUTUBE MIXCLOUD SOUNDCLOUD DEEZER UPLOAD VYBZ_ORIGINAL ROYALTY_FREE }

model Artist { id String @id; name String; mbid String? @unique }

model Track {             // canonical, provider-neutral METADATA
  id          String  @id
  title       String
  isrc        String? @unique
  mbid        String? @unique                 // MusicBrainz recording ID
  durationMs  Int?
  releaseYear Int?
  explicit    Boolean @default(false)
  artworkUrl  String?                          // provider-hosted URL, never re-hosted
  genres      String[]
  artists     TrackArtist[]
  refs        TrackProviderRef[]
}

model TrackProviderRef {  // how to find this track on each provider (still metadata)
  id String @id; trackId String; provider ProviderKind; externalId String
  externalUrl String?; lastSyncedAt DateTime
  @@unique([provider, externalId])
}

model ProviderConnection { // a user's linked music account. NOT a login method.
  id String @id; userId String; provider ProviderKind
  externalUserId String
  accessTokenEnc  Bytes    // AES-256-GCM, envelope encrypted
  refreshTokenEnc Bytes?
  tokenKeyVersion Int
  scopes String[]; expiresAt DateTime
  capabilities Json        // e.g. { premium: true, fullPlayback: true }
  status ConnectionStatus  // ACTIVE | REVOKED | ERROR
  @@unique([userId, provider])
}

model Playlist { id String @id; ownerId String; title String; theme String?
                 visibility Visibility; items PlaylistItem[] }
model PlaylistItem { playlistId String; position Int; trackId String?; mediaAssetId String?
                     @@id([playlistId, position]) }
```

No table stores provider audio. Playback rights are **computed at request time** (Section 5), not stored.

### 3.3 Media (user-owned audio and images)

```prisma
enum AssetKind   { AVATAR COVER AUDIO_TRACK AUDIO_MIX }
enum AssetStatus { PENDING_UPLOAD UPLOADED PROCESSING READY REJECTED REMOVED }
enum RightsBasis { OWN_ORIGINAL LICENSED ROYALTY_FREE PROVIDER_EMBED }

model MediaAsset {
  id String @id; ownerId String; kind AssetKind; status AssetStatus
  originalKey  String           // r2: private/originals/...
  derivedKeys  Json?            // { stream: "...m4a", waveform: "...json", hls: ...}
  mimeType String; sizeBytes Int; durationMs Int?; sha256 String?
  rightsBasis RightsBasis
  rightsAttestedAt DateTime     // user checked "I own or have rights to this"
  licenseInfo Json?             // e.g. CC license URL, source
  fingerprint FingerprintResult? // match found / no match / pending
  rejectReason String?
}
```

### 3.4 Battles

```prisma
enum BattleType   { SONG PLAYLIST DJ_MIX LIVE_DJ }
enum BattleMode   { ASYNC LIVE }
enum BattleStatus { DRAFT OPEN_CHALLENGE PENDING_ACCEPT ACCEPTED IN_PROGRESS
                    FINALIZING COMPLETE CANCELLED EXPIRED VOIDED }
enum RoundStatus  { PENDING SUBMISSIONS_OPEN VOTING_OPEN CLOSED SCORED VOIDED }

model Battle {
  id String @id; type BattleType; mode BattleMode; status BattleStatus
  title String; theme String?             // "2000s R&B"
  rules Json                              // validated by core: rounds, constraints, blind, timings
  roundCount Int
  visibility Visibility                   // PUBLIC | UNLISTED | FOLLOWERS
  creatorId String
  rematchOfId String?                     // rematch chain
  tournamentMatchId String?
  scheduledStartAt DateTime?
  startedAt DateTime?; endedAt DateTime?
  winnerParticipantId String?
  version Int @default(0)                 // optimistic concurrency for state transitions
  participants BattleParticipant[]; rounds BattleRound[]
}

model BattleParticipant {
  id String @id; battleId String; userId String; side Int   // 0 | 1 (N later)
  roundsWon Int @default(0); totalVotes Int @default(0)
  ratingBefore Float?; ratingAfter Float?
  forfeitedAt DateTime?
  @@unique([battleId, userId]); @@unique([battleId, side])
}

model BattleRound {
  id String @id; battleId String; index Int; status RoundStatus
  prompt String?                          // optional per-round theme
  submissionsCloseAt DateTime?; votingOpensAt DateTime?; votingClosesAt DateTime?
  winnerParticipantId String?
  @@unique([battleId, index])
}

model Submission {
  id String @id; roundId String; participantId String
  trackId String?; playlistId String?; mediaAssetId String?   // exactly one, by battle type
  sealedUntil DateTime?                   // hidden from opponent until round opens
  @@unique([roundId, participantId])
}

model Vote {
  id String @id; roundId String; voterId String; participantId String
  createdAt DateTime
  weight Float @default(1)                // set at tally time from trust
  status VoteStatus @default(COUNTED)     // COUNTED | DISCOUNTED | VOIDED
  signals Json                            // ipHash, deviceHash, listenProof summary
  @@unique([roundId, voterId])            // one vote per user per round, enforced by DB
}

model ListenProof {        // evidence the voter heard both sides before voting
  id String @id; roundId String; userId String; submissionId String
  playedMs Int; tier PlaybackTier; createdAt DateTime
  @@unique([roundId, userId, submissionId])
}
```

### 3.5 Competition, progression, trust and safety, infrastructure

```prisma
model Rating { userId String; category String /* SONG, PLAYLIST, DJ_MIX, genre:rnb ... */
               seasonId String; rating Float; rd Float; volatility Float; games Int
               @@id([userId, category, seasonId]) }      // Glicko-2
model Season { id String @id; name String; startsAt DateTime; endsAt DateTime }

model Tournament      { id String @id; format String /* SINGLE_ELIM, SWISS */; status String; rules Json }
model TournamentEntry { tournamentId String; userId String; seed Int?; @@id([tournamentId, userId]) }
model TournamentMatch { id String @id; tournamentId String; roundNo Int; slot Int; battleId String? }

model Challenge      { id String @id; date DateTime @unique; kind String; prompt String; rules Json }
model ChallengeEntry { challengeId String; userId String; payload Json; score Int?
                       @@id([challengeId, userId]) }

model XpEvent { id String @id; userId String; amount Int; reason String
                sourceType String; sourceId String
                @@unique([userId, reason, sourceType, sourceId]) }   // idempotent awards
model Badge     { id String @id; code String @unique; name String; criteria Json }
model UserBadge { userId String; badgeId String; awardedAt DateTime; @@id([userId, badgeId]) }

model Report           { id String @id; reporterId String; subjectType String; subjectId String
                         reason String; status String; handledById String? }
model ModerationAction { id String @id; moderatorId String; action String; subjectType String
                         subjectId String; note String; createdAt DateTime }
model RightsClaim      { id String @id; claimant Json; assetId String; status String }  // DMCA flow
model AuditLog         { id String @id; actorId String?; action String; target String; meta Json; at DateTime }

model OutboxEvent { id BigInt @id @default(autoincrement()); topic String; payload Json
                    createdAt DateTime; publishedAt DateTime? }
```

### 3.6 Integrity rules enforced in the database

- `Vote @@unique([roundId, voterId])`: one vote per round, even under race conditions.
- A check (in a DB trigger or in the transaction) blocks a vote by a participant in their own battle.
- `Submission @@unique([roundId, participantId])`, plus a partial unique index preventing the **same track twice in one battle** (`battleId, trackId`).
- `XpEvent` unique key makes awards idempotent, so job retries never double-award.
- Battle state transitions use `UPDATE ... WHERE id = ? AND version = ?` (optimistic locking).

---

## 4. Authentication architecture

### 4.1 Choice: Better Auth

| Option | Verdict |
|---|---|
| **Better Auth** | **Chosen.** First-class email/password with verification and reset, Google, Apple (plugin), DB sessions through the Prisma adapter, 2FA, built-in rate limiting. User data stays in our Postgres. |
| Auth.js (NextAuth) | Credentials provider is deliberately limited and pushes JWT sessions. Weaker for email/password. |
| Clerk | Excellent but external user store, per-MAU cost, and less control over role and trust data. |
| Supabase Auth | Good if all-in on Supabase. We aren't (Neon + Ably + R2). |

All auth access goes through `packages/core/auth` so the library can be swapped later.

### 4.2 Login methods

- **Email + password:** passwords hashed with scrypt/argon2id (library default, never custom). Email verification is required before an account can sign in at all. Reset tokens are single-use with a 30-minute expiry. Breached-password check (k-anonymity HIBP API) at sign-up and reset.
- **Google OAuth:** OIDC with PKCE and `state`. Accounts are linked automatically only when Google asserts a verified email matching an existing verified account.
- **Apple (later):** Same `Account` table, new `providerId`. Handles Apple's private relay emails and the "name only on first login" behavior.
- **Music provider connections are not logins.** Connecting Spotify creates a `ProviderConnection`, not an `Account`. This keeps login working if a provider changes its API.

### 4.3 Sessions

- Database sessions. The cookie holds a random token signed with the server secret; the token is stored in the `sessions` table (Better Auth's default; it is not hashed at rest, so DB read access must stay tightly restricted).
- Cookie: `__Host-vybz_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` (bound to `urexp.com`).
- 30-day sliding expiry, rotated on privilege change and on login. "Sign out everywhere" deletes all sessions.
- No cookie cache: every request checks the session row, so sign-out, password resets and bans take effect immediately. Revisit with Redis if session lookups show up in latency.
- Moderators and admins: **2FA required** (TOTP or passkey), 12-hour sessions, re-auth for destructive actions.

### 4.4 Roles and authorization

| Role | Can |
|---|---|
| **Guest** (no session) | Browse public battles, results, profiles, rankings. Listen to previews and embeds. Cannot vote, comment, or battle. |
| **User** | Everything above, plus vote (after email verification), create and accept Song/Playlist battles, comment, follow, earn XP. |
| **DJ/Creator** | User, plus upload audio, DJ Mix battles, DJ Studio publishing, creator profile. Granted by application or automatically by reaching a threshold. |
| **Moderator** | Review reports, hide content, void votes and rounds, suspend users (time-limited). |
| **Admin** | Everything, plus role management, feature flags, rights takedowns, permanent bans. |

- Authorization is a pure function in `packages/core/policy`: `can(actor, action, resource) → allow | deny(reason)`. Unit-tested as a matrix.
- **Checked server-side in every Server Action and Route Handler**, never only in middleware or the UI. Next.js middleware is used for redirects only. (The March 2025 middleware bypass, CVE-2025-29927, shows why auth must not live only there.)
- Resource-level rules beyond roles: participants can't vote in their own battle, blocked users can't challenge each other, private battles are visible only to invitees.

---

## 5. Music-provider architecture

### 5.1 Core principle

Three separate questions are answered by three separate layers:

1. **What is this song?** → **Catalog** (metadata: title, artist, ISRC, year, artwork). Stored and normalized.
2. **Where does it exist?** → **Provider references** (Spotify ID, Apple ID, YouTube video ID). Stored.
3. **Can *this viewer* hear it right now, and how?** → **Playback resolution**. Computed per request, never stored, because it depends on the viewer's connected accounts, subscription, region, and the provider's current terms.

### 5.2 Interfaces (in `packages/providers`)

```ts
type PlaybackTier =
  | "HOSTED_FULL"       // VYBZ-hosted audio we have rights to (uploads, originals, royalty-free)
  | "PROVIDER_FULL"     // viewer's own subscription via provider SDK (Spotify Premium, Apple Music)
  | "EMBED"             // provider's own player (YouTube IFrame, Mixcloud, SoundCloud widgets)
  | "PREVIEW"           // provider-sanctioned clip (e.g. Apple catalog preview, ~30s)
  | "LINK_OUT";         // metadata only; "Open in Spotify / Apple Music"

interface MetadataProvider {
  kind: ProviderKind;
  search(q: string, opts: SearchOpts): Promise<TrackCandidate[]>;
  getTrack(externalId: string): Promise<TrackCandidate | null>;
  lookupByIsrc?(isrc: string): Promise<TrackCandidate[]>;
}

interface PlaybackProvider {
  kind: ProviderKind;
  capabilities(viewer: ViewerContext): Promise<ProviderCapabilities>; // premium? region?
  resolve(ref: TrackProviderRef, viewer: ViewerContext): Promise<PlaybackSource | null>;
}

interface PlaybackSource {
  tier: PlaybackTier;
  provider: ProviderKind;
  // exactly one of:
  sdk?:   { kind: "spotify" | "musickit"; uri: string };  // client SDK plays it
  embed?: { kind: "youtube" | "mixcloud" | "soundcloud"; id: string };
  url?:   { signedUrl: string; expiresAt: string; mime: string }; // hosted or sanctioned preview
  link?:  { href: string };
  attribution: Attribution;  // logo and link-back requirements per provider terms
  restrictions: { maxPlayMs?: number; mustShowPlayer?: boolean; noOverlay?: boolean };
}
```

`ViewerContext` = user ID (or guest), connected providers with capabilities, region, device type.

### 5.3a Launch focus: Apple Music + YouTube

- **Apple Music is the metadata source of truth.** It provides ISRC, release year, genre and high-res artwork, which power era/genre rules and de-duplication.
- **Each Apple track is matched to a YouTube video once**, lazily (on first play or on submission), by artist, title and duration (within 5s), rejecting live, cover, remix and non-embeddable videos. The match is cached because YouTube search costs 100 of the default 10,000 daily quota units.
- **What a guest hears:** the YouTube embed (full song, visible player) or the Apple 30s preview. **What an Apple Music subscriber hears:** the full track through MusicKit JS.
- **Parity default for battles:** with no connected accounts, both sides play as YouTube embeds when both have a match, otherwise both as Apple previews.
- Requirements: an Apple Developer Program membership (MusicKit key) and a Google Cloud project with the YouTube Data API enabled. A YouTube quota increase request should go in before launch.

### 5.3 Provider matrix (must be re-verified against current terms before each launch)

| Provider | Metadata | Playback for viewer | Notes and constraints |
|---|---|---|---|
| **VYBZ Original / Royalty-free / Uploads** | Ours | `HOSTED_FULL` | Only source we fully control. Uploads need rights attestation and fingerprinting. |
| **Apple Music (MusicKit)** | Yes (developer token) | `PROVIDER_FULL` for subscribers, `PREVIEW` for others | Strong default for previews if terms permit our use case. Attribution required. |
| **Spotify** | Yes (client credentials) | `PROVIDER_FULL` via Web Playback SDK, **Premium only**, browser only | No previews for new apps. Quota limits for new apps. Policy restrictions on games/trivia and on synchronizing or overlaying. **Optional enhancement.** |
| **YouTube** | Yes (Data API, quota-limited) | `EMBED` (IFrame) | Player must be visible. No audio extraction. Ads play. Good universal fallback for watchable tracks. |
| **Mixcloud** | Yes | `EMBED` | Licensed for DJ mixes in many regions. Best route for DJ Mix battles using commercial music. |
| **SoundCloud** | Limited (API access is restricted) | `EMBED` | Widget embeds for creator content. |
| **Deezer** | Yes | `PREVIEW` | Possible preview fallback. Verify terms. |
| **MusicBrainz** | Yes (open) | none | Canonical IDs (ISRC/MBID) for de-duplicating across providers. Rate-limited, cache aggressively. |

### 5.4 Resolution algorithm

For each submission shown to a viewer, try in order and return the first that works:

1. `HOSTED_FULL` if the submission is a VYBZ-hosted asset with status READY.
2. `PROVIDER_FULL` on a provider the viewer has connected **and** where the track has a ref **and** the viewer's capabilities allow it.
3. `EMBED` (YouTube, Mixcloud, SoundCloud) if a ref exists.
4. `PREVIEW` from a provider that sanctions previews for our use.
5. `LINK_OUT`.

Resolution results are cached briefly per `(trackId, viewerCapabilityHash)` in Redis.

### 5.5 Fairness rule for battles: playback parity

A voter should judge two songs heard the same way. For each round, the client computes the **best common tier** across both submissions for that viewer (for example, both full via Spotify, or both 30-second previews). Both sides are played at that tier. If no common tier exists above `LINK_OUT`, voting stays locked for that viewer with a prompt ("Connect Apple Music or Spotify to hear both tracks"). The tier used is stored in `ListenProof`, so results can show "72% of votes from full listens".

### 5.6 Submission-time checks

When a challenger submits a track:

- It must resolve to a canonical `Track` (de-duplicated by ISRC/MBID).
- It must have **at least one tier above `LINK_OUT` for a guest** (an embed or preview), so the battle works for people with no connected accounts. Tracks failing this are flagged "limited audience" or rejected, depending on battle rules.
- Theme constraints (era, genre) are checked against metadata where possible (`releaseYear` within range). Ambiguous cases are allowed but the audience can flag them.

### 5.7 Token handling for connected providers

- OAuth with PKCE. Tokens encrypted at rest (AES-256-GCM, per-row random nonce, data key from a key held in Vercel env as a KMS-style master, versioned for rotation).
- Refresh is server-side only. The client receives **only short-lived access tokens**, and only for SDKs that require one in the browser (Spotify Web Playback SDK, MusicKit user token).
- Revocation: user disconnect deletes tokens and calls the provider's revoke endpoint where available.

### 5.8 Never

- Never download, cache, proxy, or re-host audio from Spotify, Apple Music, YouTube, or any provider.
- Never scrape.
- Never mix, overlay, crossfade, or time-stretch provider audio (the DJ Studio works only on hosted, rights-cleared audio).
- Never hide required player UI or attribution.

---

## 6. Battle engine architecture

### 6.1 Placement

The engine is **pure TypeScript in `packages/core/battles`**: a state machine plus scoring functions with no I/O. A thin service layer in `apps/web` loads state, calls the engine, persists the result, and writes outbox events in one transaction. Inngest drives time-based transitions. This makes the rules exhaustively unit-testable and replayable.

### 6.2 Battle state machine

```
DRAFT ──publish──▶ OPEN_CHALLENGE ──accept──▶ ACCEPTED ──start──▶ IN_PROGRESS
   │                    │                         │                   │
   │              (direct invite)                 │            all rounds SCORED
   │                    ▼                         │                   ▼
   │             PENDING_ACCEPT ──decline/expire──┴──▶ CANCELLED / EXPIRED
   │                                                          FINALIZING
   └──delete──▶ (removed)                                         │
                                                         fraud check, ratings, XP
                                                                  ▼
                               moderator ──void──▶ VOIDED    COMPLETE ──rematch──▶ new DRAFT
```

### 6.3 Round state machine

```
PENDING ─▶ SUBMISSIONS_OPEN ─(both submitted | deadline)─▶ VOTING_OPEN ─(deadline | live host)─▶ CLOSED ─▶ SCORED
                     │                                                                          
              missing submission at deadline ─▶ round forfeited by that side (rules decide: forfeit round or battle)
```

### 6.4 Rules configuration (validated by Zod in core)

```ts
type BattleRules = {
  roundCount: 3 | 5 | 7 | 10;
  submissionMode: "PER_ROUND" | "ALL_UPFRONT_SEALED"; // sealed = both lock all 10 picks at start
  blindVoting: boolean;              // hide which user picked which track until reveal
  revealTallies: "LIVE" | "AT_ROUND_CLOSE" | "AT_BATTLE_END";
  timing: { submissionWindow: Duration; votingWindow: Duration }; // async; live uses host pacing
  constraints?: { eraFrom?: number; eraTo?: number; genres?: string[]; maxTrackLengthMs?: number };
  minVotesToCount: number;           // under this, round goes to tiebreak or is extended
  voterEligibility: { minAccountAgeHours: number; requireVerifiedEmail: true };
};
```

Defaults for the example ("2000s R&B, 10 rounds"): `PER_ROUND`, blind voting on, tallies revealed at round close, 24h submission and 24h voting windows (async) or 3 minutes per round (live), era 2000–2009.

### 6.5 Scoring

- **Round winner:** higher weighted vote total. Ties are broken by unweighted count, then by earliest-to-majority, then marked a **draw** (no round point).
- **Battle winner:** most rounds won. Tiebreak by total weighted vote share across all rounds. If still tied, a **sudden-death round** is created automatically.
- **Vote weight:** 1.0 by default. Votes flagged by fraud checks are DISCOUNTED (weight 0–0.5) or VOIDED. Weight is applied at **tally time**, never shown to the voter.
- **Playlist battles:** each round compares the i-th track of each playlist, or the audience votes on whole playlists in one round with a listen requirement across N tracks. Format chosen in rules.
- **DJ Mix battles:** usually 1–3 rounds of segments or full mixes. Fair-listen threshold is a minimum listened duration rather than the full mix.

### 6.6 Ratings, XP, progression

- **Glicko-2** rating per category (SONG, PLAYLIST, DJ_MIX, and genre sub-ladders) per season. Rating change is computed in `battle.finalize`. Battles below a minimum audience size count at reduced weight to prevent farming via friends.
- **XP** comes from an event ledger (`XpEvent`), idempotent by source. Examples: vote cast (+2, daily cap), battle completed (+20), win (+30), streaks, daily challenge.
- **Badges** are rules evaluated on domain events ("10 wins", "first upset vs a +200 rated opponent").

### 6.7 Rematch

"Run it back" clones rules and opponent into a new DRAFT with `rematchOfId`. Both sides must accept. Rematch chains appear on profiles as rivalries.

### 6.8 Concurrency and correctness

- All transitions run in one DB transaction with optimistic locking on `Battle.version`.
- Inngest jobs are idempotent: closing an already-closed round is a no-op.
- Votes are written to Postgres first (source of truth), then a Redis counter is incremented for live display. The final tally is always recomputed from Postgres at round close.

---

## 7. Real-time architecture

### 7.1 Choice: Ably (behind an interface)

Ably provides managed WebSockets with presence, message history (catch-up after reconnect), and **token authentication with per-channel capabilities**, which suits a model where the server is the only publisher. Supabase Realtime and Pusher are viable alternatives. `packages/realtime` exposes `publish(channel, event)` and `issueClientToken(user, channels)` so the vendor can be swapped.

### 7.2 Server-authoritative model

- Clients **never publish game state**. Votes, submissions, and transitions go over HTTPS to the server, which validates, commits, and then publishes.
- Publishing uses a **transactional outbox**. The domain transaction writes an `OutboxEvent` row, and the relay job publishes it to Ably. No event is published for a transaction that rolled back, and none are lost if Ably is briefly unavailable.
- Every event carries a monotonically increasing `seq` per battle. On reconnect, the client either replays from Ably history or refetches a snapshot from `/api/v1/battles/:id/state` if it detects a gap.

### 7.3 Channels

| Channel | Publishers | Subscribers | Events |
|---|---|---|---|
| `battle:{id}` | server | anyone allowed to view | `round.opened`, `round.closed`, `tally.updated` (throttled to ≤1/s, only if `revealTallies = LIVE`), `battle.completed` |
| `battle:{id}:chat` | server (after moderation filter) | viewers | `comment.created`, `comment.removed` |
| `battle:{id}:presence` | clients (presence only) | viewers | listener count, "who's watching" |
| `user:{id}` | server | that user only | notifications, challenge received, your turn to submit |
| `live:{roomId}` (Phase 5) | server/host | room members | synchronized playback cues, host controls |

Client tokens are issued by `/api/realtime/token`, valid for 60 minutes, with subscribe capability only (plus presence on battle channels).

### 7.4 Live battles (Phase 5)

- **Synchronized listening** sends playback cues (`play trackX at serverTime T`) and each client plays its own resolved source. Provider full-playback sync is subject to provider terms (Spotify restricts synchronized playback), so live battles default to **hosted or embed tiers**.
- **Live DJ battles** (real-time audio from a DJ) need a media server: **LiveKit** (WebRTC SFU) for low latency, with HLS fan-out for large audiences. Only rights-cleared material or venue-licensed streams. Requires a separate legal track.

---

## 8. Storage architecture

### 8.1 Buckets and layout (Cloudflare R2)

| Bucket | Access | Contents |
|---|---|---|
| `vybz-private` | Never public. Presigned PUT for upload, worker read. | `originals/{userId}/{assetId}` (raw uploads), quarantine until scanned |
| `vybz-media` | Served via `media.urexp.com` through **signed, short-lived URLs** for audio. Public cache for images. | `audio/{assetId}/stream.m4a` (AAC 256k), `audio/{assetId}/hls/*` (later), `waveforms/{assetId}.json`, `images/{assetId}/{size}.webp` |

Provider artwork is **hot-linked from provider CDNs**, not copied, unless the terms allow caching.

### 8.2 Upload flow

```
client ──POST /api/uploads (kind, size, mime, rights attestation)──▶ server
   server: authz (creator role for audio), quota check, create MediaAsset(PENDING_UPLOAD),
           return presigned PUT (key fixed by server, Content-Type and Content-Length locked, 10 min)
client ──PUT bytes──▶ R2 vybz-private
client ──POST /api/uploads/:id/complete──▶ server ──Inngest media.process──▶ worker:
   1. HEAD object: verify size/type; sniff magic bytes (not the client's MIME claim)
   2. ffmpeg probe: duration, codecs; reject malformed or oversized
   3. transcode → AAC stream file; strip metadata (EXIF/ID3, which can contain PII)
   4. audiowaveform → peaks JSON
   5. audio fingerprint (ACRCloud or Audible Magic) → if it matches commercial catalog
      and rightsBasis ≠ LICENSED: REJECTED or held for review
   6. images: re-encode to WebP (strips payloads), generate sizes
   7. status = READY, outbox event
```

### 8.3 Limits

- Avatars ≤ 5 MB. Tracks ≤ 50 MB / 15 min. Mixes ≤ 300 MB / 90 min (multipart upload).
- Per-user storage quota by role, enforced at presign time.
- Allowed types: audio `mp3, m4a/aac, wav, flac`; images `jpeg, png, webp`. SVG is never accepted.

### 8.4 Lifecycle

Unfinished uploads are deleted after 24h. Removed or rejected assets are purged after 30 days (or immediately for legal takedowns). Originals are kept while the asset is live, so the platform can re-transcode.

---

## 9. Security model

### 9.1 Threat-driven controls

| Requirement | Control |
|---|---|
| **Server-side authorization** | `can()` policy checked in every Server Action and Route Handler, plus row-level filtering in the data-access layer. Integration tests assert that each mutation rejects unauthorized roles. |
| **Secure OAuth token storage** | AES-256-GCM envelope encryption, key versioning and rotation, tokens never logged, never sent to the client except short-lived SDK tokens. |
| **Rate limiting** | Upstash Ratelimit (sliding window) keyed by user ID and IP hash. Example limits: login 5/min/IP and 10/hour/account, sign-up 3/hour/IP, vote 30/min/user, battle create 10/day/user, upload presign 20/hour/creator, search 60/min. Better Auth's limiter covers auth routes. |
| **Input validation** | Zod schemas at every boundary (actions, route handlers, webhooks, provider responses). Strict length limits. Unknown keys rejected. |
| **Role-based access** | Roles plus resource rules (Section 4.4). Admin and moderator actions written to `AuditLog`. |
| **Secure uploads** | Server-chosen keys, presigned PUT with locked content-type and length, private quarantine bucket, magic-byte sniffing, transcoding, metadata stripping, fingerprinting, no SVG/HTML, served from a separate subdomain with `Content-Disposition` and `X-Content-Type-Options: nosniff`. |
| **Vote fraud protection** | See 9.2. |
| **CSRF** | Server Actions have built-in origin checks. Route Handlers that mutate require `POST` plus `Origin`/`Host` match. `SameSite=Lax` cookies. No state-changing GETs. OAuth uses `state` and PKCE. |
| **XSS** | React escaping by default. No `dangerouslySetInnerHTML` on user content (lint rule). Bios and comments are plain text with linkification only. Strict **CSP with nonces** (`script-src 'nonce-…' 'strict-dynamic'`), allow-listed `frame-src` for YouTube/Mixcloud/SoundCloud and SDK origins. |
| **SQL injection** | Prisma parameterized queries. `$queryRawUnsafe` banned by lint. Raw SQL only through tagged `$queryRaw`. |
| **Session management** | Opaque DB sessions, `__Host-` cookie, rotation on login and privilege change, revoke-all, 2FA for staff, idle timeout for staff. |
| **Secrets** | Vercel encrypted env vars per environment. No secrets in the client bundle (`server-only` imports). Secret scanning in CI. |
| **Headers** | HSTS (preload), CSP, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal. |
| **Dependencies** | Renovate, `pnpm audit` in CI, lockfile-only installs, pinned GitHub Actions. |
| **Abuse and safety** | Report flows, blocklists, profanity and slur filtering on text, moderation queue, appeal path, DMCA agent and takedown flow (`RightsClaim`). |
| **Privacy** | IPs stored only as salted hashes. Data export and delete-account flows (GDPR/CCPA). Minimal PII. |

### 9.2 Vote fraud protection (layered)

1. **Eligibility:** signed-in, verified email, account older than N hours (configurable per battle), not a participant, not blocked by a participant, not suspended.
2. **Uniqueness:** DB unique constraint `(roundId, voterId)`.
3. **Fair-listen gate:** the vote is accepted only if `ListenProof` exists for both submissions at the common tier, above a minimum played duration. Proofs come from client events validated server-side (signed per-round listen nonce, timing plausibility). Not cryptographically tamper-proof, but it raises the cost of bot voting considerably.
4. **Velocity and rate limits** per user, IP hash, and device hash. Turnstile challenge when thresholds trip.
5. **Trust score** (0–100) from account age, verification, history of normal activity, prior flags. Low-trust votes are counted but weighted down at tally.
6. **Post-round anomaly scan** (`fraud.scan`): bursts of new accounts voting for one side, shared IP/device clusters, votes arriving from a participant's share link in a narrow window with near-zero listen time. Results: discount or void votes, flag the participant, queue for a moderator.
7. **Transparency:** the result page shows counted votes. Moderators can void a round or battle with an audit trail. Ratings are recomputed if a battle is voided.
8. **Sybil friction for ranked play:** ranked battles (those that affect ratings) can require phone verification later if abuse appears. Unranked battles stay open.

---

## 10. Deployment architecture

### 10.1 Environments

| Env | Web | DB | Other services |
|---|---|---|---|
| **Local** | `next dev` | Docker Postgres or Neon dev branch | Upstash dev DB, Ably sandbox app, R2 dev bucket, Inngest dev server |
| **Preview** (every PR) | Vercel preview URL | **Neon branch per PR** (auto-created, migrated, deleted on close) | Shared staging services, seeded test data |
| **Staging** | `staging.urexp.com` | Neon staging | Staging keys for all providers |
| **Production** | `urexp.com` (apex), `www` redirects to apex | Neon prod with PITR (7–30 days) | Prod keys, R2 prod buckets |

### 10.2 Domains

- `urexp.com`: the app (Vercel).
- `media.urexp.com`: R2 custom domain for media (separate origin reduces XSS blast radius from user content).
- `api.urexp.com`: not needed initially. Reserved for a future public or mobile API.
- Email sending domain `mail.urexp.com` with SPF, DKIM, and DMARC.

### 10.3 CI/CD (GitHub Actions + Vercel)

1. On PR: install (frozen lockfile), lint, typecheck, unit tests (Vitest, `packages/core` near 100% branch coverage for battle rules), Prisma `migrate diff` check, build, Playwright e2e against the preview URL, Lighthouse mobile budget.
2. On merge to `main`: deploy to staging, run `prisma migrate deploy` as a **separate release step** (never during `next build`), smoke tests.
3. Promote to production via Vercel promotion (instant rollback by re-promoting the previous deployment).
4. **Migrations are backward-compatible** (expand, then contract) so a rollback of the app never breaks on a newer schema.
5. Worker deploys to Fly.io from the same pipeline (Docker image with ffmpeg and audiowaveform).

### 10.4 Operations

- **Monitoring:** Sentry (errors, performance traces with release tagging), Vercel analytics (Core Web Vitals), Inngest dashboard (job failures and retries), Ably and Neon dashboards, uptime checks on key routes.
- **Alerts:** error rate spike, job failure rate, round-close lag (a round past its deadline and not closed), vote ingestion errors, DB connection saturation.
- **Backups:** Neon PITR plus a nightly logical dump to R2 (separate account credentials). R2 object versioning on the private bucket.
- **Feature flags** (PostHog): every battle type, provider, and retention feature ships behind a flag.

### 10.5 Rough cost shape at launch

All chosen services have free or low-cost starter tiers. Expected meaningful costs at small scale: Vercel Pro, Neon (compute hours), Ably (connections and messages), the fingerprinting API (per lookup), and Fly.io (one small machine). Audio egress is free on R2. Exact figures depend on traffic and plan choices, so they are left for a later estimate.

---

## 11. Development roadmap

Each phase ends with a shippable, usable product. Phases after 1 are reordered by what users actually do in Phase 1.

### Phase 0: Foundations
- Review the existing prototype (UX flows, naming, what worked).
- Legal review kickoff: Spotify, Apple, YouTube, Mixcloud terms for battles and trivia. Terms of service, privacy policy, DMCA agent registration.
- Monorepo scaffold, CI pipeline, environments, Neon, Vercel, Sentry, PostHog.
- Design system v1: tokens, type, core components, battle stage prototype in Storybook.
- Auth: email/password, Google, sessions, email verification, password reset, roles, 2FA for staff.
- Profiles (handle, avatar upload: first use of the storage pipeline, images only).
- **Exit:** a user can sign up, verify, set a profile, and sign in on mobile.

### Phase 1: MVP core loop (Song-for-Song, async)
- Catalog: Apple Music search as the metadata source, YouTube matching for embeds, ISRC de-duplication. **(Started in the repo: provider adapters, matcher, resolver, search page.)**
- Playback resolution with `EMBED`, `PREVIEW`, `LINK_OUT`, plus Apple Music account connection (MusicKit) for `PROVIDER_FULL`. Spotify deferred.
- Battle engine: Song battles, open and direct challenges, per-round submissions, async timing, blind voting, round and battle scoring, sudden death.
- Voting with eligibility, fair-listen gate, rate limits, DB uniqueness, post-round fraud scan v1.
- Realtime: battle channel updates, user notifications. Email notifications for "your turn".
- Result screen, share cards (dynamic OG images), deep links, rematch.
- Reporting and a basic moderation queue.
- PWA install and push notifications (web push).
- **Exit:** the "2000s R&B, 10 rounds" example works end to end for two users and a voting audience, including people with no connected music account.

### Phase 2: Social and progression
- Playlist battles.
- Follows, feed, comments, notification center.
- XP ledger, levels, badges, streaks.
- Glicko-2 ratings, seasons, leaderboards (global, by type, by genre).
- Daily music challenges v1 (e.g. "best opener for a Friday night", community voted).
- **Exit:** users have reasons to come back daily without an active battle.

### Phase 3: Creators and DJ Mix battles
- Creator role and application flow.
- Audio upload pipeline: transcode, waveform, fingerprinting, rights attestation, DMCA flow.
- DJ Mix battles using hosted rights-cleared audio and Mixcloud/SoundCloud embeds.
- Waveform player with segment voting.
- DJ Studio v1: a browser mixing tool **limited to hosted, rights-cleared audio** (VYBZ originals, royalty-free, user's own uploads), using the Web Audio API.
- **Exit:** a DJ can enter a mix battle without legal exposure for the platform.

### Phase 4: Competitive depth
- Tournaments (single elimination, then Swiss), brackets, scheduled rounds.
- Music Trivia (scope depends on legal review; likely built on owned metadata plus `HOSTED_FULL`/`PREVIEW` audio only).
- Challenge variants, seasonal events, rivalries.
- Fraud model v2 (trust score tuning from Phase 1–3 data).

### Phase 5: Live
- Live (scheduled) battles: synchronized rounds, host controls, live tallies, presence, live chat with moderation.
- Live DJ battles: LiveKit, rights-cleared streams, possible venue partnerships. Dedicated stateful room service if needed.
- DJ University: courses and lessons (content system, progress tracking, practice battles).

### Phase 6: Platform expansion
- Sign in with Apple.
- Native apps (Expo/React Native sharing `packages/core` and API), or a wrapped PWA as an interim step.
- Public API (`api.urexp.com`), monetization (subscriptions, creator tips, sponsored tournaments).

### Cross-cutting from day one
Accessibility (WCAG 2.2 AA: contrast holds on the dark theme, keyboard voting, screen-reader scoreboards), performance budgets (mobile LCP < 2.5s on 4G), i18n-ready strings, analytics events for every loop step (discover, listen, battle, vote, result, share, rematch) to measure the funnel.

---

## Open questions for Baba

1. Can you share the prototype (repo link, Figma, or screenshots)? It would sharpen Section 1 and Phase 1 scope.
2. Is there a company entity for provider developer agreements (Spotify extended quota and Apple Developer Program both need one)?
3. Target launch region(s)? This affects licensing, age rules, and which preview providers are usable.
4. Should guests be able to cast "unofficial" votes (shown separately), or is voting strictly sign-in only? This plan assumes sign-in only.
5. When ready to start building, which GitHub repository should be used, or should a new one be created?
