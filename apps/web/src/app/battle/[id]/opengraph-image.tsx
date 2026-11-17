import type { BattleView } from "@vybz/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getBattleView } from "@/server/battles/service";
import { getBattleDeps } from "@/server/context";

/**
 * The share card for a battle link (iMessage, Instagram, X, WhatsApp...):
 * the matchup, the score and where it stands. Private battles get a plain
 * VYBZ card, so a link preview never reveals them.
 */

export const alt = "A VYBZ music battle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0A0614";
const VIOLET = "#8B5CF6";
const SOFT = "#C4B5FD";
const MUTED = "#A59CBB";
const SIDES = ["#8B5CF6", "#F472B6", "#22D3EE", "#FBBF24", "#34D399", "#FB7185", "#60A5FA", "#A3E635"];

type Font = { name: string; data: ArrayBuffer; weight: 500 | 800; style: "normal" };
let fonts: Promise<Font[]> | null = null;

/** Inter from @fontsource; falls back to the built-in font if it can't be read. */
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    ([500, 800] as const).map(async (weight) => {
      const buf = await readFile(join(process.cwd(), "node_modules/@fontsource/inter/files", `inter-latin-${weight}-normal.woff`));
      return { name: "Inter", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight, style: "normal" as const };
    }),
  ).catch((err) => {
    console.warn("share card fonts unavailable", err);
    return [];
  });
  return fonts;
}

async function load(id: string): Promise<BattleView | null> {
  try {
    const b = await getBattleView(getBattleDeps(), null, id);
    return b.visibility === "PUBLIC" ? b : null;
  } catch {
    return null;
  }
}

function status(b: BattleView): string {
  const winner = b.participants.find((p) => p.id === b.winnerParticipantId);
  switch (b.status) {
    case "COMPLETE":
      return winner ? `@${winner.user.handle} wins` : "Ended level";
    case "IN_PROGRESS": {
      const r = b.rounds.find((x) => x.status !== "SCORED");
      return r ? `Live · round ${r.index + 1} of ${b.rounds.length} · ${r.status === "VOTING_OPEN" ? "vote now" : "picking"}` : "Live";
    }
    case "OPEN_CHALLENGE":
      return b.format === "DUEL" ? "Open challenge · take it on" : `Join · ${b.entrants.joined}/${b.entrants.max} in`;
    case "PENDING_ACCEPT":
      return "Challenge sent";
    default:
      return "Battle";
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const [b, f] = await Promise.all([load((await params).id), loadFonts()]);
  const players = b ? [...b.participants].sort((x, y) => x.side - y.side).slice(0, 4) : [];
  const duel = b?.format === "DUEL" && players.length === 2;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: `linear-gradient(135deg, ${INK} 0%, #1E0B3A 60%, #3B0F6B 100%)`, color: "white", padding: 64, fontFamily: f.length ? "Inter" : "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 900, letterSpacing: 6 }}>VYBZ</div>
          {b ? <div style={{ display: "flex", fontSize: 26, color: SOFT, fontWeight: 700 }}>{status(b)}</div> : null}
        </div>

        {b ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 900, lineHeight: 1.1, maxWidth: 1050 }}>{b.title}</div>
            {b.theme ? <div style={{ display: "flex", fontSize: 28, color: MUTED, marginTop: 10 }}>{b.theme}</div> : null}
            {players.length ? (
              <div style={{ display: "flex", alignItems: "center", marginTop: 44, gap: 28 }}>
                {players.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 28 }}>
                    {i > 0 ? <div style={{ display: "flex", fontSize: 34, color: MUTED, fontWeight: 800 }}>vs</div> : null}
                    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                      <div
                        style={{
                          display: "flex",
                          width: 84,
                          height: 84,
                          borderRadius: 42,
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#2A0E4F",
                          border: `5px solid ${SIDES[p.side % SIDES.length]}`,
                          fontSize: 38,
                          fontWeight: 900,
                        }}
                      >
                        {(p.user.displayName || p.user.handle).slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>@{p.user.handle}</div>
                        {b.status !== "OPEN_CHALLENGE" ? <div style={{ display: "flex", fontSize: duel ? 56 : 34, fontWeight: 900, color: p.id === b.winnerParticipantId ? SOFT : "white" }}>{p.roundsWon}</div> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {b.participants.length > players.length ? <div style={{ display: "flex", fontSize: 30, color: MUTED }}>+{b.participants.length - players.length} more</div> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 900 }}>BATTLE YOUR TASTE.</div>
            <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 16 }}>Pick tracks, face the crowd, win the vote.</div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: MUTED }}>
          <div style={{ display: "flex" }}>Listen to every pick, then vote.</div>
          <div style={{ display: "flex", height: 10, width: 220, borderRadius: 5, background: VIOLET }} />
        </div>
      </div>
    ),
    { ...size, fonts: f },
  );
}
