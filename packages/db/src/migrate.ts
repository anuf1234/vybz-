import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";

// Kept out of the main entry so app bundles never try to resolve the migrations folder.
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
