import "server-only";
import { prisma } from "@vybz/db";
import { matchYouTube } from "../catalog";
import { apple, defaultStorefront, youtube } from "../providers";
import type { CatalogPort } from "./lineup";
import { battleService } from "./service";

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

export const battles = battleService({ prisma, catalog: catalogPort });
