import type { Metadata } from "next";
import { PartyCodeEntry } from "@/party/player";

export const metadata: Metadata = { title: "Join a party" };

export default function JoinPage() {
  return <PartyCodeEntry />;
}
