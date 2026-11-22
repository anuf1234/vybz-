import { type BattleView, type ParticipantView, battleResultSummary } from "@vybz/core";
import { ImageResponse } from "next/og";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";
import { INK, MUTED, SOFT, STORY, VIOLET, WIDE, battleCard, loadFonts } from "@/server/share-card";
import { artData } from "@/server/share-cards";

/**
 * The result card a player shares when a battle ends: who beat whom, the
 * score, the theme, the picks that won it, and a dare to take them on. Drawn
 * from the sharer's side (`as`). No emoji: the renderer would fetch them.
 */

const WIN = "#39FF88";
const SIDES = ["#8B5CF6", "#F472B6", "#22D3EE", "#FBBF24", "#34D399", "#FB7185", "#60A5FA", "#A3E635"];

async function load(id: string, code: string | null): Promise<BattleView | null> {
  try {
    // Public results for anyone; private ones only with the battle's invite code.
    const b = await getBattleView(getBattleDeps(), null, id, undefined, code);
    return b.status === "COMPLETE" ? b : null;
  } catch {
    return null;
  }
}

interface Pick {
  title: string;
  artist: string;
  art: string | null;
}

/** Up to three picks from rounds the focus player won. */
async function winningPicks(b: BattleView, who: ParticipantView | null): Promise<Pick[]> {
  if (!who) return [];
  const tracks = b.rounds
    .filter((r) => r.winnerParticipantId === who.id)
    .flatMap((r) => r.entries.filter((e) => e.participantId === who.id).flatMap((e) => e.tracks.map((t) => t.track)))
    .slice(0, 3);
  return Promise.all(tracks.map(async (t) => ({ title: t.title, artist: t.artistName, art: await artData(t.artworkUrl) })));
}

function Avatar({ p, img, size, ring }: { p: ParticipantView; img: string | null; size: number; ring: string }) {
  const style = { display: "flex", width: size, height: size, borderRadius: size / 2, border: `${Math.round(size / 18)}px solid ${ring}`, alignItems: "center", justifyContent: "center", background: "#2A0E4F", fontSize: size * 0.45, fontWeight: 800 } as const;
  // eslint-disable-next-line @next/next/no-img-element
  return img ? <img src={img} width={size} height={size} style={{ ...style, objectFit: "cover" }} alt="" /> : <div style={style}>{(p.user.displayName || p.user.handle).slice(0, 1).toUpperCase()}</div>;
}

const OUTCOME_WORD = { WIN: "VICTORY", LOSS: "SO CLOSE", DRAW: "DEAD EVEN", SPECTATOR: "FINAL" } as const;

export async function resultCard(id: string, format: "wide" | "story", opts: { as?: string | null; code?: string | null } = {}): Promise<ImageResponse> {
  const [b, f] = await Promise.all([load(id, opts.code ?? null), loadFonts()]);
  // Not finished, private without the code, or gone: the regular battle card.
  if (!b) return battleCard(id, format);
  const s = battleResultSummary(b, opts.as);
  const focus = s.outcome === "SPECTATOR" || s.outcome === "LOSS" ? s.winner : s.me;
  const left = s.me ?? s.winner ?? [...b.participants].sort((x, y) => x.side - y.side)[0]!;
  const right = s.opponent ?? b.participants.find((p) => p.id !== left.id) ?? null;
  const duel = b.format === "DUEL" && right !== null;
  const [picks, leftImg, rightImg] = await Promise.all([winningPicks(b, focus), artData(left.user.image), right ? artData(right.user.image) : null]);
  const accent = s.outcome === "WIN" ? WIN : SOFT;
  const story = format === "story";
  const font = f.length ? "Inter" : "sans-serif";

  const scoreRow = duel ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: story ? 44 : 28, marginTop: story ? 56 : 18 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Avatar p={left} img={leftImg} size={story ? 170 : 96} ring={left.id === b.winnerParticipantId ? accent : SIDES[left.side % SIDES.length]!} />
        <div style={{ display: "flex", fontSize: story ? 40 : 24, fontWeight: 800 }}>@{left.user.handle}</div>
      </div>
      <div style={{ display: "flex", fontSize: story ? 190 : 110, fontWeight: 800, letterSpacing: -4 }}>{`${left.roundsWon}–${right!.roundsWon}`}</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Avatar p={right!} img={rightImg} size={story ? 170 : 96} ring={right!.id === b.winnerParticipantId ? accent : SIDES[right!.side % SIDES.length]!} />
        <div style={{ display: "flex", fontSize: story ? 40 : 24, fontWeight: 800 }}>@{right!.user.handle}</div>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginTop: story ? 56 : 18 }}>
      <Avatar p={left} img={leftImg} size={story ? 200 : 110} ring={accent} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: story ? 120 : 70, fontWeight: 800 }}>{s.place ? `#${s.place}` : "WIN"}</div>
        <div style={{ display: "flex", fontSize: story ? 36 : 22, color: MUTED }}>{`of ${b.participants.length} players`}</div>
      </div>
    </div>
  );

  const pickRow = picks.length ? (
    <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: story ? 22 : 10, marginTop: story ? 70 : 0 }}>
      <div style={{ display: "flex", fontSize: story ? 30 : 18, color: MUTED, fontWeight: 800, letterSpacing: 4 }}>{focus && focus.id === s.me?.id ? "THE PICKS THAT WON IT" : `@${focus?.user.handle ?? ""}'S WINNING PICKS`.toUpperCase()}</div>
      <div style={{ display: "flex", gap: story ? 28 : 16 }}>
        {picks.map((p, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", width: story ? 270 : 150, gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.art ? <img src={p.art} width={story ? 270 : 150} height={story ? 270 : 150} style={{ borderRadius: 24, objectFit: "cover" }} alt="" /> : <div style={{ display: "flex", width: story ? 270 : 150, height: story ? 270 : 150, borderRadius: 24, background: "#2A0E4F" }} />}
            <div style={{ display: "flex", fontSize: story ? 28 : 16, fontWeight: 800, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p.title}</div>
            <div style={{ display: "flex", fontSize: story ? 24 : 14, color: MUTED, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p.artist}</div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const dare = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: 10, padding: story ? "36px 56px" : "18px 28px", borderRadius: story ? 44 : 24, background: VIOLET }}>
      <div style={{ display: "flex", fontSize: story ? 52 : 28, fontWeight: 800, textAlign: "center" }}>{s.callToAction}</div>
      <div style={{ display: "flex", fontSize: story ? 32 : 18, opacity: 0.9 }}>Tap the link to battle on VYBZ</div>
    </div>
  );

  if (story) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", background: `linear-gradient(180deg, ${INK} 0%, #1E0B3A 55%, #3B0F6B 100%)`, color: "white", padding: "120px 70px", fontFamily: font }}>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 800, letterSpacing: 14 }}>VYBZ</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center", width: "100%" }}>
            <div style={{ display: "flex", fontSize: 44, color: accent, fontWeight: 800, letterSpacing: 10 }}>{OUTCOME_WORD[s.outcome]}</div>
            <div style={{ display: "flex", marginTop: 22, padding: "10px 30px", borderRadius: 40, border: `3px solid ${SOFT}`, fontSize: 34, fontWeight: 800, color: SOFT }}>{s.theme}</div>
            {scoreRow}
            <div style={{ display: "flex", fontSize: 54, fontWeight: 800, lineHeight: 1.15, textAlign: "center", marginTop: 60, maxWidth: 920, justifyContent: "center" }}>{s.headline}</div>
            {pickRow}
          </div>
          {dare}
        </div>
      ),
      { ...STORY, fonts: f },
    );
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: `linear-gradient(135deg, ${INK} 0%, #1E0B3A 60%, #3B0F6B 100%)`, color: "white", padding: 52, gap: 40, fontFamily: font }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 800, letterSpacing: 6 }}>VYBZ</div>
            <div style={{ display: "flex", fontSize: 24, color: accent, fontWeight: 800, letterSpacing: 6 }}>{OUTCOME_WORD[s.outcome]}</div>
          </div>
          {scoreRow}
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, lineHeight: 1.2 }}>{s.headline}</div>
          {dare}
        </div>
        {pickRow ? <div style={{ display: "flex", alignItems: "center" }}>{pickRow}</div> : null}
      </div>
    ),
    { ...WIDE, fonts: f },
  );
}
