import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Database | Tx;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool, close: () => pool.end() };
}
