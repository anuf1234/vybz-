import type { ViewerContext } from "@vybz/providers";

export function guestViewer(storefront: string): ViewerContext {
  return { userId: null, storefront, connections: [] };
}
