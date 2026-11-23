import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { WatchParty } from "@/components/watch-party";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { serverEnv } from "@/server/env";

/**
 * Watch-party mode: a full-screen view of a battle for casting, screen-sharing,
 * or an OBS/Streamlabs browser source while going live on YouTube, TikTok,
 * Instagram, Twitch or Facebook. Landscape by default; ?layout=vertical for
 * 9:16 (TikTok and Instagram Live). Silent unless the person running the
 * screen turns music on with their own YouTube or Apple Music; viewers scan
 * the QR code to listen and vote in the app.
 */

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string; layout?: string }> };

export const metadata: Metadata = { title: "Watch party", robots: { index: false } };

export default async function WatchPage({ params, searchParams }: Props) {
  const [{ id }, { code, layout }] = await Promise.all([params, searchParams]);
  const b = await getBattleView(getBattleDeps(), null, id, undefined, code ?? null).catch(() => null);
  if (!b) notFound();
  const base = serverEnv().BETTER_AUTH_URL ?? "https://urexp.com";
  const link = `${base}/battle/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  const qr = await QRCode.toString(link, { type: "svg", margin: 1, color: { dark: "#0A0614", light: "#FFFFFF" } });
  return <WatchParty initial={b} code={code ?? null} qrSvg={qr} link={link.replace(/^https?:\/\//, "")} vertical={layout === "vertical"} />;
}
