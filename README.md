# VYBZ

Competitive social music: song, playlist and DJ battles where the audience listens and votes round by round. Production domain: urexp.com.

The full architecture and roadmap live in [docs/architecture.md](docs/architecture.md).

## What's here

| Path | What it is |
|---|---|
| `packages/core` | Battle engine: state machine, scoring with sudden death, fair-listen vote gate, eligibility, authorization policy, shared API types. Pure TypeScript, no I/O. |
| `packages/db` | Drizzle schema and SQL migrations for auth, catalog, battles, votes and listen proofs. |
| `packages/providers` | Apple Music and YouTube adapters, Apple→YouTube matcher, per-viewer playback resolution with battle parity, and a demo catalog for development. |
| `apps/web` | Next.js app: the website (installable PWA), Better Auth (`/api/auth`), the public API (`/api/v1`) used by the website and the mobile app, and the round scheduler (`/api/cron/advance`). |
| `apps/mobile` | Expo app for iOS and Android. See [apps/mobile/README.md](apps/mobile/README.md). |

### What works end to end

Sign up (email/password or Google), challenge someone (or post an open challenge), agree the terms (genre and era such as "90s R&B", rounds, tracks per round, who judges, pace) with counter-offers until both sides accept, pick tracks per round (sealed until voting opens), audience listens to both picks at the same playback tier, votes unlock only after enough real listening, rounds close on their deadlines (with forfeits, vote-window extensions and a sudden-death round when level), results, rankings, profiles and rematches.

**Apple Music and YouTube.** Players pick tracks from either catalog (YouTube picks are matched back to Apple Music when possible, which also gives them a release year and genre for battle rules). Listeners choose **Listen on: YouTube or Apple Music** for each battle; both sides always play on the chosen service at the same quality, so the comparison stays fair. YouTube plays full songs in its own player for everyone. Apple Music plays 30-second previews for everyone and full songs for subscribers on iPhone (see the mobile README).

**Judging.** Each battle picks who decides a round: the crowd, the AI judge, both combined into one score (the AI's pick counts for an agreed share, 25–75%), or both on separate scorecards (the crowd's card is official, the AI's shown alongside). The AI judge is Claude via the Anthropic API (`ANTHROPIC_API_KEY`). It doesn't hear the audio, since VYBZ never downloads provider audio: it judges from what it knows about each song and its fit with the theme, sees the sides only as A and B, and its verdict stays hidden until the round closes.

**Group battles and community (Step 1).** Battles can be duels or group battles for 3–8 players, who join a lobby that starts when it's full, when the host starts it, or when the join window closes with enough players. Battles can be public or private: private ones are reachable only by invited players and people with the invite link (`/battle/<id>?code=…`, which opens the app). Up to 3 genres per battle; length presets (1 hour to 7 days) split into pick and vote windows. Listeners heart individual tracks; spectators chat (rate-limited, links blocked, optional word blocklist), react with emoji and see how many are watching. A daily battle with a rotating genre/era theme is created by the scheduler. Moderators feature battles and work a report queue (hide message, void battle, suspend user, dismiss). Finished battles show stats (votes, unique voters, listen-to-vote rate, reactions, most-hearted track) and every track can be replayed. Players get in-app notifications and phone push notifications (challenges, invites, joins, your pick, voting open, results).

**Finding songs.** The picker suggests songs that fit the battle's genres and era as soon as it opens (Apple Music's genre charts, or Apple's own decade playlists such as "90s R&B" when there's an era), shows matching artists above song results while you search, and opens an artist's songs ranked by popularity (Apple Music's top-songs list). Every row plays a short preview, and anything outside the battle's era is marked before you pick it.

**Library and playlists (Step 2).** Save any song from a battle, search or playlist with the bookmark. Make playlists by hand or let VYBZ fill one for a genre and era (25 popular fitting songs to start), then add, remove and reorder songs. Playlists are private (shareable by link) or public, can have collaborators who add and reorder songs, and show up under Discover when public. Saved songs and playlists appear in the battle picker, so you can pick straight from them. Songs stored this way skip the YouTube search until they're picked for a battle, to spare the YouTube quota.

**Social (Step 3).** Follow people (follower and following lists, "people to follow" from who follows you, who you've battled, and top players). Post text with an optional song, public playlist or public battle; like and comment. Two feeds: Following and For you, loading older posts as you scroll. One-to-one messages when either person follows the other, with unread counts. Blocking hides two people from each other everywhere (feeds, comments, follows, messages). Notifications for new followers, likes, comments and messages open the right screen. Posts, comments, messages and users can be reported; moderators hide them from the queue.

**Progression (Step 4).** Leaderboards: global, people you follow, or one genre; this week, 30 days or all time; by battles won, rounds won or XP, with your own row pinned. 22 achievements with progress bars (battles, wins, flawless wins, genres, daily battles, votes, posts, followers, playlists, streaks, levels). A daily reward on Home: claim once a day in your time zone, climbing a 7-day ladder. Streaks for daily claims, wins in a row and days battling. XP and coins for finishing and winning battles, rounds won, votes and posts (votes and posts capped per day), plus achievement, daily and level-up rewards; levels follow 50·L·(L−1) XP. The XP & coins screen shows your balance, how to earn, and the full history. Coins can't be spent yet.

**Engagement (Step 5).** Quick battle: one tap matches you with someone waiting for the same genre and era, or opens a battle others can take; quick battles are 3 rounds of one song, 30 minutes to pick, and AI-judged when the judge is set up. The VYBZ bot (a house account, kept off leaderboards and out of rewards) plays anyone whose quick battle nobody took within 2 minutes, or right away on request, and enters every daily battle; it needs the AI judge (`ANTHROPIC_API_KEY`). Battle links unfurl as share cards (matchup, score, status) and open a page with the scoreboard and every scored round's songs; the app's Share button writes a message that fits the moment. An evening "your streak ends tonight" push (7–10pm local, at most once a day). A coin shop: streak freezes (cover a missed day) and profile frames shown on avatars.

**Sharing, watch parties and imports (Step 6, part A).** Every public battle has a 9:16 story card (`/battle/:id/story`) that the app shares through the phone's share sheet to Instagram and Facebook Stories, Snapchat, TikTok or Messages. Watch-party mode (`/watch/:id`) is a full-screen view of a live battle (scoreboard, picks, vote bars, reactions, chat, and a QR code to listen and vote) for casting to a TV or as an OBS/Streamlabs browser source when going live; it carries no audio, so streams don't rebroadcast the music. Paste a public YouTube or YouTube Music playlist link to import it (up to 100 songs) as a VYBZ playlist you can battle from.

**Sign-in, GIFs and comment likes (Step 6, part B).** Continue with Apple (native sheet on iPhone), Google, Facebook or TikTok; each button shows only when its keys are set. GIFs from GIPHY in battle chat, posts, comments and messages: searches run from the phone with `GIPHY_API_KEY`, and the server only accepts GIPHY image links. Likes on comments and chat messages, with a notification the first time someone likes your comment. Delete account (Profile), plus privacy, terms and data-deletion pages (`/privacy`, `/terms`, `/data-deletion`) for the App Store and the Meta and TikTok developer reviews.

**Music trivia (Step 7).** A daily 10-question challenge (the same questions for everyone that day, 20 seconds each, faster answers score more, one go per day) mixing music history, artist, genre, album-art and Guess the song questions, plus practice by category and genre. Answers are checked one at a time on the server against the clock, so the right answer never reaches the phone early. XP and coins (perfect games pay extra), a daily trivia streak, today/week/all-time leaderboards and five trivia badges. The results screen compares your score with everyone who played today (rank, percentile, average, how many got each question right) and ends with "You know music. Can you win a battle?", which opens Quick battle in the genre you did best in. Questions come from a reviewed starter bank (facts only, titles but never lyrics), from the catalog (album art and Guess the song use the provider's own artwork and previews, never re-hosted) and from AI drafts; moderators approve, edit, reject and retire them, and see questions players report, in **Moderation → Trivia questions**. A lyrics guard rejects any question that quotes or asks for lyrics. Guess the song stays off until `TRIVIA_AUDIO_PREVIEWS=true`; turn it on only once you've confirmed your music provider's terms allow previews in a game.

**DJ Vybz Studio, DJ University and DJ battles (Step 8).** A browser DJ studio at `/studio` (Web Audio; the app opens it in its own view, signed in with a single-use token). Two decks with waveform and beat grid, play/pause/cue/set cue, seek, tempo fader (±16%) with nudge, BPM and key readouts, tap tempo, sync, 3-band EQ with kills, a filter, channel volume, an equal-power crossfader, a phase meter, track timers and a crowd meter. It only plays audio people may manipulate: the **VYBZ pack** (eight original tracks from 92 to 174 BPM, made in code by `apps/web/scripts/studio-pack.py`, free to mix, record and battle) and files from the person's own device after they confirm they have the rights (decoded in the browser, never uploaded). Streaming-service audio is never loaded. **Record** a mix to save it as a DJ set or, if it's 30s–3min of VYBZ pack tracks, a battle set; sets store the moves, not audio, and replay in the studio. **DJ University**: 11 courses (DJ Basics, BPM, Beatmatching, Cue Points, Crossfading, EQ, Transitions, Song Selection, Building Energy, Reading a Crowd, Battle Strategy), each Learn → Watch (the studio performs the technique with captions) → Practice (a live exercise the studio checks) → Quiz → XP and coins, with badges. **DJ battles**: start one with a battle set, another DJ takes it with theirs, listeners must hear most of both sets before voting, voting runs 24 hours, the winner earns XP and coins. Learn → practice → battle.

**Vybz Party Mode (Step 9).** One person hosts on a TV or laptop at `/party` (no account needed); everyone joins on their phone by scanning the QR code or typing the code (`VYBZ-4821`) at `/p`, with just a nickname. Up to 30 players. Games: **Music Trivia** (questions from the reviewed trivia bank, themed to the party's genre, 20 seconds each, faster right answers score more, a reveal with how the room answered) and **Battle of the Playlists** (two players secretly pick a song for a prompt like "Best slow jam of all time", everyone else votes, 50 points per vote). **Name That Song** plays official previews on the host screen and stays off until `TRIVIA_AUDIO_PREVIEWS=true`. **Finish the Lyrics** needs a lyrics licence and isn't offered. **DJ Showdown** is coming. The server runs the clock and moves each round on when everyone's answered or time's up; the host can skip ahead (N) or remove players. Players signed in through the app earn XP (more for each game's top scorer). Idle parties end after 12 hours.

**Album and Single Wars (Step 10).** Pick two albums (or two singles) and fans vote for a week, category by category: overall album, best individual songs, production and beats, lyrics and storytelling, and replay value (singles: better song, production, lyrics, replay). Album wars add track-by-track battles (track 1 vs track 1, up to 20) with 30-second previews where the provider offers them. Votes can change until the war closes; a category's split only shows once you've voted in it, so early votes don't sway later ones. The overall vote decides the winner (ties go to whoever won more categories) and the creator is notified. **Best of** ranks albums and singles by votes won over the last week, month and year. "Charting now" (Apple Music's most-played albums) gives people a reason to start a war after every big release. Voting earns a little XP (a few wars a day).

**Onboarding and the trivia pipeline.** New players get one clear path: pick up to three genres, play a first quick battle (against the VYBZ bot when the AI judge is set up, so it starts right away), then do today's trivia. Home shows a "Start here" card and hides the other modes until both are done; finishing pays a one-time welcome bonus (50 XP, 25 coins). Anyone can skip. People who joined before onboarding existed aren't sent through it. **Weekly trivia pipeline:** once a week (daily while fewer than 14 days of fresh questions are left) the scheduler drafts new questions with Claude, aimed at the thinnest genres and spread across artist, genre and history questions (`TRIVIA_WEEKLY_DRAFTS`, default 60), adds catalog questions, and notifies moderators. **Moderation → Trivia questions** shows bank health (days of daily trivia left, drafts waiting, thinnest genres, last run) and a one-at-a-time review screen (Approve / Reject / Skip). Drafts never reach players until approved. AI drafting needs `ANTHROPIC_API_KEY`.

### Music rules this code enforces

- Metadata (what a song is) is kept separate from playback (how a given viewer may hear it). Playback is resolved per request and never stored.
- No audio is downloaded, proxied or re-hosted. Apple previews and artwork load straight from Apple; YouTube plays only in its visible embedded player.
- Everyone can hear something without connecting an account: a YouTube embed or a 30-second Apple Music preview. A track that a guest can't hear can't be submitted to a battle.

## Getting started

Requires Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # set DATABASE_URL and BETTER_AUTH_SECRET at least
DATABASE_URL=postgres://postgres@localhost:5432/vybz pnpm --filter @vybz/db migrate
pnpm dev                                       # http://localhost:3000
```

With `VYBZ_DEMO_CATALOG=true`, search returns eight synthesized demo tracks, so you can play a full battle without any provider keys. For real music:

- **Apple Music:** an Apple Developer Program membership. Create a key with MusicKit enabled under Certificates, IDs & Profiles → Keys, then set `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID` and `APPLE_MUSIC_PRIVATE_KEY` (the .p8 contents).
- **YouTube:** a Google Cloud project with the YouTube Data API v3 enabled and an API key restricted to that API. The default quota is 10,000 units/day and each search costs 100, so results are cached and each Apple track is matched to YouTube once, when it's first submitted.

Then run the mobile app: see [apps/mobile/README.md](apps/mobile/README.md).

### Deploying

- **Render (current test deployment):** `render.yaml` defines the web service and Postgres; the start command applies migrations first. A Render cron job (`vybz-scheduler`, every 5 minutes) calls `/api/cron/advance` with `CRON_SECRET`. Set `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` and `YOUTUBE_API_KEY` in the dashboard. Optional: `ANTHROPIC_API_KEY` turns on the AI judge. Sign-in: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (plus `GOOGLE_IOS_CLIENT_ID`), `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`; Apple needs nothing beyond the bundle ID. `GIPHY_API_KEY` turns on GIFs; `SUPPORT_EMAIL` sets the contact on the legal pages.
- Run `pnpm --filter @vybz/db migrate` against production as a release step (not during `next build`).
- `apps/web/vercel.json` schedules `/api/cron/advance` every minute (needs `CRON_SECRET`; per-minute crons need Vercel Pro). Battles also advance whenever they're viewed, so a missed tick only delays closing rounds nobody is watching.
- Set `AUTH_REQUIRE_EMAIL_VERIFICATION=true` and `RESEND_API_KEY` in production. `VYBZ_DEMO_CATALOG` is refused on the live site.

## Scripts

```bash
pnpm test        # unit tests; DB integration tests run when DATABASE_URL_TEST / DATABASE_URL_TEST_WEB are set
pnpm typecheck
pnpm build
```
