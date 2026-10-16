/**
 * Development seed: four players, a finished battle with votes, a live one,
 * Marcus's open 90s R&B challenge and a challenge waiting on Marcus.
 *
 *   pnpm --filter @vybz/web db:seed          # refuses if seed users exist
 *   pnpm --filter @vybz/web db:seed --reset  # wipes app data first (dev only)
 *
 * Uses the sample catalog (MUSIC_FIXTURES=1), so run the app in fixture mode
 * to hear the tracks. Never runs against production.
 */
import { hashPassword } from "better-auth/crypto";
import type { Actor } from "@vybz/core";
import { FIXTURE_TRACKS, FixtureMusicAdapter } from "@vybz/providers";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine: DATABASE_URL may come from the environment.
}

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  console.error("Refusing to seed: this looks like production.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (apps/web/.env.local).");
  process.exit(1);
}

const { prisma } = await import("@vybz/db");
const { battleService } = await import("../src/lib/battles/service");
const { socialService } = await import("../src/lib/social/service");

export const SEED_PASSWORD = "vybz-demo-pass";
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

let clock = new Date();
const at = (msAgo: number) => void (clock = new Date(Date.now() - msAgo));
const tick = (ms: number) => void (clock = new Date(clock.getTime() + ms));
const svc = battleService({ prisma, catalog: new FixtureMusicAdapter("/api/dev/tone"), now: () => clock });
const social = socialService({ prisma });
const track = (title: string) => {
  const t = FIXTURE_TRACKS.find((x) => x.title === title);
  if (!t) throw new Error(`No sample track called ${title}`);
  return t.externalId;
};

const PEOPLE = [
  { username: "marcus", name: "Marcus", bio: "90s R&B or nothing. Undefeated at cookouts.", genres: ["R&B", "Soul"] },
  { username: "nia", name: "Nia", bio: "2000s girl. If it has a key change, I'm in.", genres: ["R&B", "Pop"] },
  { username: "dj_kay", name: "DJ Kay", bio: "Weekends behind the decks. Afrobeats to amapiano.", genres: ["Afrobeats", "Amapiano", "House"], role: "CREATOR" as const },
  { username: "fan", name: "Jordan Fan", bio: "Here to vote.", genres: ["Hip-Hop"] },
  { username: "tasha", name: "Tasha", bio: "Spectator, critic, menace.", genres: ["Hip-Hop", "R&B"] },
];

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "users", "music_tracks", "rate_limits", "verifications" CASCADE',
  );
}

async function person(p: (typeof PEOPLE)[number]): Promise<Actor> {
  const id = `seed_${p.username}`;
  const role = "role" in p ? p.role : "USER";
  await prisma.user.create({
    data: {
      id,
      name: p.name,
      email: `${p.username}@example.com`,
      emailVerified: true,
      role,
      profile: { create: { username: p.username, displayName: p.name, bio: p.bio, favoriteGenres: p.genres } },
      accounts: { create: { id: `${id}_cred`, accountId: id, providerId: "credential", password: await hashPassword(SEED_PASSWORD) } },
    },
  });
  return { id, role, status: "ACTIVE", emailVerified: true, handle: p.username };
}

const setup = (over: Record<string, unknown>) => ({
  type: "SONG_FOR_SONG",
  mode: "DIRECT",
  title: "Battle",
  theme: "Anything goes",
  genre: null,
  tagline: null,
  roundCount: 5,
  playlistLength: null,
  visibility: "PUBLIC",
  votingDurationMs: DAY,
  revealIntervalMs: 0,
  hideTotals: true,
  eraFrom: null,
  eraTo: null,
  scheduledFor: null,
  ...over,
});

/** Listens to both sides honestly (the clock moves), then votes. */
async function listenAndVote(voter: Actor, battleId: string, roundIndex: number, selection: 0 | 1) {
  const subs = await prisma.battleSubmission.findMany({ where: { battleId, round: { index: roundIndex } }, orderBy: { side: "asc" } });
  for (const s of subs) {
    await svc.reportListen(voter, { submissionId: s.id, playedMs: 0 });
    tick(11_000);
    await svc.reportListen(voter, { submissionId: s.id, playedMs: 11_000 });
  }
  await svc.vote(voter, { battleId, roundIndex, selection });
}

async function main() {
  if (process.argv.includes("--reset")) {
    await reset();
    console.log("Wiped app data.");
  } else if (await prisma.profile.findUnique({ where: { username: "marcus" } })) {
    console.log("Seed users already exist. Run with --reset to start over.");
    return;
  }

  const [marcus, nia, kay, fan, tasha] = await Promise.all(PEOPLE.map(person));

  // 1. Finished: Marcus vs Nia, 2000s R&B, five rounds, three days ago.
  at(3 * DAY);
  const done = await svc.create(marcus, {
    setup: setup({ title: "2000s R&B Showdown", theme: "2000s R&B", genre: "R&B", eraFrom: 2000, eraTo: 2009, tagline: "Bring your best 2000s cut." }),
    opponent: "nia",
    lineup: { appleIds: ["Try Again", "Ignition (Remix)", "Yeah!", "We Belong Together", "No One"].map(track) },
  });
  tick(H);
  await svc.accept(nia, done.id);
  await svc.submitLineup(nia, done.id, { appleIds: ["Crazy in Love", "Burn", "Let Me Love You", "Irreplaceable", "Fallin'"].map(track) });
  const votes: [Actor, (0 | 1)[]][] = [
    [fan, [0, 1, 0, 0, 1]],
    [tasha, [1, 1, 0, 1, 1]],
    [kay, [0, 0, 1, 0, 1]],
  ];
  for (const [voter, picks] of votes) for (const [round, side] of picks.entries()) await listenAndVote(voter, done.id, round, side);
  await social.comment(fan, { battleId: done.id, body: "Round 3 was robbery. Yeah! is undefeated.", roundIndex: 2 });
  await social.comment(tasha, { battleId: done.id, body: "Nia's Fallin' closer was cold.", roundIndex: null });
  await social.toggleReaction(fan, { battleId: done.id, roundIndex: 2, kind: "FIRE" });
  await social.toggleReaction(tasha, { battleId: done.id, roundIndex: 4, kind: "MIND_BLOWN" });
  tick(DAY + MIN);
  await svc.advance(done.id);

  // 2. Live: Nia vs DJ Kay, Heartbreak, three rounds, voting open for most of a day.
  at(2 * H);
  const live = await svc.create(nia, {
    setup: setup({ title: "Heartbreak Hotel", theme: "Heartbreak", roundCount: 3, tagline: "Cry if you want to." }),
    opponent: "dj_kay",
    lineup: { appleIds: ["So Sick", "Kill Bill", "Untitled (How Does It Feel)"].map(track) },
  });
  tick(20 * MIN);
  await svc.accept(kay, live.id);
  await svc.submitLineup(kay, live.id, { appleIds: ["We Belong Together", "Blinding Lights", "No Scrubs"].map(track) });
  await listenAndVote(fan, live.id, 0, 1);
  await listenAndVote(fan, live.id, 1, 0);
  await listenAndVote(tasha, live.id, 0, 0);
  await social.comment(tasha, { battleId: live.id, body: "Kill Bill vs Blinding Lights is a crazy round 2.", roundIndex: 1 });

  // 3. Marcus's open challenge: anyone can accept.
  at(30 * MIN);
  await svc.create(marcus, {
    setup: setup({
      type: "PLAYLIST",
      mode: "OPEN",
      title: "90s R&B Playlist Battle",
      theme: "90s R&B",
      genre: "R&B",
      roundCount: 1,
      playlistLength: 3,
      eraFrom: 1990,
      eraTo: 1999,
      tagline: "Nobody can beat my 90s R&B playlist.",
    }),
    lineup: { appleIds: ["Waterfalls", "No Scrubs", "Say My Name"].map(track) },
  });

  // 4. Waiting on Marcus: DJ Kay challenged him to Cookout Classics.
  at(10 * MIN);
  await svc.create(kay, {
    setup: setup({ title: "Cookout Classics", theme: "Cookout Classics", tagline: "Uncle-approved only." }),
    opponent: "marcus",
    lineup: { appleIds: ["Superstition", "Get Lucky", "Hot in Herre", "Family Affair", "Get Ur Freak On"].map(track) },
  });

  clock = new Date();
  for (const [who, whom] of [
    [fan, "marcus"],
    [fan, "nia"],
    [tasha, "marcus"],
    [nia, "marcus"],
    [kay, "nia"],
  ] as const) {
    await social.follow(who, whom);
  }

  const final = await prisma.battle.findUniqueOrThrow({ where: { id: done.id }, select: { scoreA: true, scoreB: true, status: true } });
  console.log(`Seeded. Finished battle ${done.id}: ${final.status} ${final.scoreA}-${final.scoreB}. Live battle ${live.id}.`);
  console.log(`Log in as marcus, nia, dj_kay, fan or tasha (@example.com) with password "${SEED_PASSWORD}".`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
