import type { Metadata } from "next";
import { PartyStart } from "@/party/host";

export const metadata: Metadata = { title: "Vybz Party Mode", description: "Host a music party game on your TV. Guests join from their phones." };

export default function PartyPage() {
  return <PartyStart />;
}
