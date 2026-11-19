import type { Metadata } from "next";
import { headers } from "next/headers";
import { eq, schema } from "@vybz/db";
import type { UserRow } from "@/server/battles/service";
import { getAuth, getBattleDeps } from "@/server/context";
import { canTakeLesson } from "@/server/dj";
import { Studio } from "@/studio/studio";

export const metadata: Metadata = { title: "DJ Vybz Studio", description: "Learn to DJ, record sets and battle other DJs." };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v.length < 100 ? v : null);

export default async function StudioPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  let user: { handle: string } | null = null;
  let row: UserRow | null = null;
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    const u = session?.user as { handle?: string } | undefined;
    if (session) {
      user = { handle: u?.handle ?? "you" };
      [row = null] = await getBattleDeps().db.select().from(schema.user).where(eq(schema.user.id, session.user.id));
    }
  } catch {
    user = null;
  }
  // Pro courses' demos and practice open only for Pro members (the studio itself is free).
  const wanted = one(sp.lesson);
  const lessonId = wanted && (await canTakeLesson(getBattleDeps().db, row, wanted).catch(() => false)) ? wanted : null;
  const mode = one(sp.mode);
  return (
    <Studio
      user={user}
      lessonId={lessonId}
      mode={mode === "demo" || mode === "practice" ? mode : null}
      setId={one(sp.set)}
      djBattleId={one(sp.djbattle)}
      embed={sp.embed === "app"}
    />
  );
}
