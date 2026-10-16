import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

function createClient(): PrismaClient {
  // `next build` evaluates server modules without runtime secrets. The pg pool
  // only connects on the first query, so a placeholder is safe there.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const connectionString = process.env.DATABASE_URL ?? (isBuild ? "postgresql://build@localhost/build" : undefined);
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process, reused across hot reloads in development.
const globalForPrisma = globalThis as unknown as { vybzPrisma?: PrismaClient };

function client(): PrismaClient {
  return (globalForPrisma.vybzPrisma ??= createClient());
}

/**
 * Created on first use, so importing this module (e.g. during `next build`)
 * doesn't require DATABASE_URL.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
