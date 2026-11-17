import { battleCard } from "@/server/share-card";

/** A 9:16 story card (1080×1920) the app shares to Instagram, Snapchat, TikTok and Facebook. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const res = await battleCard((await params).id, "story");
  res.headers.set("Cache-Control", "public, max-age=60");
  return res;
}
