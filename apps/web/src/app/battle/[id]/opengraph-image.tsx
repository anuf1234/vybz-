import { WIDE, battleCard } from "@/server/share-card";

/** The link-preview card (iMessage, Instagram, X, WhatsApp...). */
export const alt = "A VYBZ music battle";
export const size = WIDE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  return battleCard((await params).id, "wide");
}
