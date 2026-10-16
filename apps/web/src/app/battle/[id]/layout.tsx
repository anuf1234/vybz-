import { prisma } from "@vybz/db";
import { notFound } from "next/navigation";

/**
 * Checks the battle exists before the page's loading skeleton streams, so a
 * bad link gets a real 404 status instead of a 200 with a not-found page.
 */
export default async function BattleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = /^[a-z0-9]{1,40}$/i.test(id) ? await prisma.battle.findUnique({ where: { id }, select: { status: true } }) : null;
  if (!found || found.status === "DRAFT") notFound();
  return children;
}
