import { type DbHandle, createDb, sql } from "@vybz/db";
import { runMigrations } from "@vybz/db/migrate";

export const TEST_DB_URL = process.env.DATABASE_URL_TEST_WEB;

export async function freshDb(): Promise<DbHandle> {
  const h = createDb(TEST_DB_URL!, { max: 5 });
  await h.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations(h.db);
  return h;
}
