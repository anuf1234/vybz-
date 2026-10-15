# VYBZ

Competitive social music: song, playlist and DJ battles where the audience listens and votes round by round. Production domain: urexp.com.

The full architecture and roadmap live in [docs/architecture.md](docs/architecture.md).

## What's here so far

Phase 1 groundwork, focused on the two launch music providers:

| Path | What it is |
|---|---|
| `packages/providers` | Provider abstraction. Apple Music adapter (catalog search, ISRC lookup, previews, MusicKit developer tokens), YouTube adapter (music search, embeddability), Apple→YouTube matcher, and per-viewer playback resolution with battle playback parity. |
| `apps/web` | Next.js app: home page and a catalog search page that plays Apple Music previews and YouTube embeds. |
| `packages/config` | Shared TypeScript config. |

### Music rules this code enforces

- Metadata (what a song is) is kept separate from playback (how a given viewer may hear it). Playback is resolved per request and never stored.
- No audio is downloaded, proxied or re-hosted. Apple previews and artwork load straight from Apple; YouTube plays only in its visible embedded player.
- Everyone can hear something without connecting an account: a YouTube embed or a 30-second Apple Music preview.

## Getting started

Requires Node 22 and pnpm 10.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # add your keys
pnpm dev                                       # http://localhost:3000
```

Keys:

- **Apple Music:** an Apple Developer Program membership. Create a key with MusicKit enabled under Certificates, IDs & Profiles → Keys, then set `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID` and `APPLE_MUSIC_PRIVATE_KEY` (the .p8 contents).
- **YouTube:** a Google Cloud project with the YouTube Data API v3 enabled and an API key restricted to that API. The default quota is 10,000 units/day and each search costs 100, so results are cached.

The app runs with either provider alone. With both, Apple Music supplies metadata and each track can be matched to its YouTube video.

## Scripts

```bash
pnpm test        # unit tests (Vitest)
pnpm typecheck
pnpm build
```
