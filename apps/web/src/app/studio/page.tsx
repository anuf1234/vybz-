import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAuth } from "@/server/context";
import { Studio } from "@/studio/studio";

export const metadata: Metadata = { title: "DJ Vybz Studio", description: "Learn to DJ, record sets and battle other DJs." };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v.length < 100 ? v : null);

export default async function StudioPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  let user: { handle: string } | null = null;
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    const u = session?.user as { handle?: string } | undefined;
    if (session) user = { handle: u?.handle ?? "you" };
  } catch {
    user = null;
  }
  const mode = one(sp.mode);
  return (
    <Studio
      user={user}
      lessonId={one(sp.lesson)}
      mode={mode === "demo" || mode === "practice" ? mode : null}
      setId={one(sp.set)}
      djBattleId={one(sp.djbattle)}
      embed={sp.embed === "app"}
    />
  );
}
