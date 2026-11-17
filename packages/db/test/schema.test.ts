import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DbHandle, createDb, newId, schema } from "../src";
import { runMigrations } from "../src/migrate";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("schema on Postgres", () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb(url!, { max: 2 });
    await h.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(h.db);
    await runMigrations(h.db); // idempotent
  });
  afterAll(() => h?.close());

  const mkUser = (handle: string) => ({ id: newId(), name: handle, email: `${handle}@example.com`, handle });

  it("enforces handle format and uniqueness", async () => {
    await h.db.insert(schema.user).values(mkUser("alice"));
    await expect(h.db.insert(schema.user).values({ ...mkUser("alice"), email: "other@example.com" })).rejects.toThrow();
    await expect(h.db.insert(schema.user).values(mkUser("Bad Handle"))).rejects.toThrow();
  });

  it("allows one vote per user per round and one use of a track per battle", async () => {
    const [a, b, c] = [mkUser("ann"), mkUser("ben"), mkUser("cat")];
    await h.db.insert(schema.user).values([a, b, c]);
    const battleId = newId();
    await h.db.insert(schema.battle).values({ id: battleId, status: "IN_PROGRESS", title: "t", rules: {}, roundCount: 3, creatorId: a.id });
    const [pa, pb] = [newId(), newId()];
    await h.db.insert(schema.battleParticipant).values([
      { id: pa, battleId, userId: a.id, side: 0 },
      { id: pb, battleId, userId: b.id, side: 1 },
    ]);
    const roundId = newId();
    await h.db.insert(schema.battleRound).values({ id: roundId, battleId, index: 0, status: "VOTING_OPEN" });
    await h.db.insert(schema.track).values([
      { id: "t1", title: "One", artistName: "X" },
      { id: "t2", title: "Two", artistName: "Y" },
    ]);
    const s1 = newId();
    await h.db.insert(schema.submission).values({ id: s1, battleId, roundId, participantId: pa, trackId: "t1" });
    await expect(
      h.db.insert(schema.submission).values({ id: newId(), battleId, roundId, participantId: pb, trackId: "t1" }),
    ).rejects.toThrow();

    const v = { battleId, roundId, voterId: c.id, submissionId: s1, participantId: pa, tier: "EMBED" };
    await h.db.insert(schema.vote).values({ id: newId(), ...v });
    await expect(h.db.insert(schema.vote).values({ id: newId(), ...v })).rejects.toThrow();
  });

  it("generates sortable ids", () => {
    const ids = Array.from({ length: 50 }, newId);
    expect(new Set(ids).size).toBe(50);
    expect(ids.every((id) => /^[0-9a-z]{20}$/.test(id))).toBe(true);
  });
});
