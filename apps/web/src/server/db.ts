import "server-only";
import { type DbHandle, createDb } from "@vybz/db";
import { requireEnv } from "./env";

// One pool per server process; survives dev hot reloads.
const g = globalThis as unknown as { __vybzDb?: DbHandle };

export function getDb() {
  g.__vybzDb ??= createDb(requireEnv("DATABASE_URL"));
  return g.__vybzDb.db;
}
