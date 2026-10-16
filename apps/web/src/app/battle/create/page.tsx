import { THEME_PRESETS } from "@vybz/core";
import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import { Forbidden } from "@/components/ui/states";
import { requireActor } from "@/lib/auth/server";
import { configured } from "@/lib/providers";
import { storage } from "@/lib/uploads/storage";
import { type Prefill, QuickBattle } from "./quick-battle";

export const metadata: Metadata = { title: "New battle" };
export const dynamic = "force-dynamic";

type Search = { searchParams: Promise<{ opponent?: string; rematch?: string; welcome?: string; theme?: string }> };

export default async function CreateBattlePage({ searchParams }: Search) {
  const q = await searchParams;
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  const actor = await requireActor({ next: `/battle/create${qs ? `?${qs}` : ""}` });

  let prefill: Prefill = {};
  if (typeof q.opponent === "string" && q.opponent) prefill.opponent = q.opponent.replace(/^@/, "").slice(0, 30);
  if (typeof q.theme === "string" && THEME_PRESETS.some((t) => t.id === q.theme)) prefill.presetId = q.theme;

  if (typeof q.rematch === "string" && /^[a-z0-9]{1,40}$/i.test(q.rematch)) {
    const prev = await prisma.battle.findUnique({
      where: { id: q.rematch },
      include: { participants: { include: { user: { select: { profile: { select: { username: true } } } } } } },
    });
    const opp = prev?.participants.find((p) => p.userId !== actor.id);
    if (!prev || prev.status !== "COMPLETED" || !prev.participants.some((p) => p.userId === actor.id) || !opp) {
      return <Forbidden body="You can only ask for a rematch of a finished battle you played in." />;
    }
    prefill = {
      rematchOf: prev.id,
      opponent: opp.user.profile?.username ?? "",
      setup: {
        type: prev.type === "LIVE_DJ" ? "SONG_FOR_SONG" : prev.type,
        theme: prev.theme,
        genre: prev.genre,
        roundCount: prev.roundCount,
        playlistLength: prev.playlistLength,
        eraFrom: prev.eraFrom,
        eraTo: prev.eraTo,
        votingDurationMs: prev.votingDurationMs,
        hideTotals: prev.hideTotals,
        visibility: prev.visibility,
        title: `${prev.title} (rematch)`.slice(0, 80),
      },
    };
  }

  return (
    <QuickBattle
      me={actor.handle ?? "you"}
      prefill={prefill}
      welcome={q.welcome === "1"}
      canSearch={configured.appleMusic}
      canUpload={storage !== null}
    />
  );
}
