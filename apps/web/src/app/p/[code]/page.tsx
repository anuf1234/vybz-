import type { Metadata } from "next";
import { PartyPlayer } from "@/party/player";

export const metadata: Metadata = { title: "Vybz Party", robots: { index: false } };

export default async function PartyPlayerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PartyPlayer code={code.replace(/\D/g, "").slice(0, 6)} />;
}
