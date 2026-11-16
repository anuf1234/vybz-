import { createDb } from "./client";
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log("migrations applied");
} finally {
  await handle.close();
}
