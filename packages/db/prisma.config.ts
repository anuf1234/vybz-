import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Optional here so `prisma generate` works without a database (CI, installs).
  // Commands that need a connection fail with a clear error if it's missing.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
