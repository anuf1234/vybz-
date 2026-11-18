import type { Metadata } from "next";
import { PartyHost } from "@/party/host";

export const metadata: Metadata = { title: "Party host", robots: { index: false } };

export default async function PartyHostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PartyHost code={code.replace(/\D/g, "").slice(0, 6)} />;
}
