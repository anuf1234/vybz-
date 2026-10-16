import "server-only";
import { prisma } from "@vybz/db";
import { matchYouTube } from "../catalog";
import { apple, defaultStorefront, youtube } from "../providers";
import { type CatalogPort, battleService } from "./service";

export { BattleError } from "./service";

export const battles = battleService({ prisma });

/** Picks are looked up in Apple Music (or the sample catalog in development), never taken from the client. */
export const catalogPort: CatalogPort | null = buildCatalogPort();

function buildCatalogPort(): CatalogPort | null {
  const am = apple;
  if (!am) return null;
  return {
    getTrack: (appleId) => am.getTrack(appleId, { storefront: defaultStorefront }),
    ...(youtube ? { matchYouTube: (t) => matchYouTube(t.externalId, defaultStorefront) } : {}),
  };
}
