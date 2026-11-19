import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { eq, schema, sql } from "@vybz/db";
import { getBattleDeps } from "@/server/context";
import { getWar } from "@/server/wars";
import { chart } from "@/server/verdict";
import { getTournament } from "@/server/tournaments";
import { rankView } from "@/server/ranked";
import { INK, MUTED, SOFT, STORY, VIOLET, WIDE, type Font, loadFonts } from "@/server/share-card";

/**
 * No emoji on cards: the renderer would fetch emoji images from a CDN.
 *
 * Share cards beyond battles: wars, drops, the weekly chart, ranks and
 * tournaments. Each comes as a story (1080×1920, for Instagram, TikTok,
 * Snapchat and Facebook stories) and a wide link preview (1200×630).
 * Nothing private is ever drawn: unknown ids get the plain VYBZ card.
 */

export type CardFormat = "wide" | "story";

function frame(format: CardFormat, f: Font[], body: ReactNode, footer: string): ImageResponse {
  const story = format === "story";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: story ? "center" : "stretch",
          background: `linear-gradient(${story ? 180 : 135}deg, ${INK} 0%, #1E0B3A 55%, #3B0F6B 100%)`,
          color: "white",
          padding: story ? "130px 80px" : 56,
          fontFamily: f.length ? "Inter" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: story ? 64 : 40, fontWeight: 800, letterSpacing: story ? 14 : 6 }}>VYBZ</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "stretch", justifyContent: "center", flex: 1, width: "100%" }}>{body}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: 14 }}>
          <div style={{ display: "flex", fontSize: story ? 44 : 26, fontWeight: 800 }}>{footer}</div>
          <div style={{ display: "flex", fontSize: story ? 34 : 22, color: MUTED }}>Search VYBZ · urexp.com</div>
        </div>
      </div>
    ),
    { ...(story ? STORY : WIDE), fonts: f },
  );
}

/**
 * Artwork as a data URI, fetched by us so the card renderer never fetches
 * arbitrary URLs. https only (plus the dev server's own demo art), 3 MB max,
 * images only. Null on any problem; the card draws a plain square instead.
 */
export async function artData(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const devLocal = process.env.NODE_ENV !== "production" && u.protocol === "http:" && u.hostname === "localhost";
  if (u.protocol !== "https:" && !devLocal) return null;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(5000), redirect: "error" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function Cover({ url, size }: { url: string | null; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} width={size} height={size} style={{ borderRadius: size / 12, objectFit: "cover" }} alt="" /> : <div style={{ display: "flex", width: size, height: size, borderRadius: size / 12, background: "#2A0E4F" }} />;
}

function plain(format: CardFormat, f: Font[]): ImageResponse {
  return frame(format, f, <div style={{ display: "flex", fontSize: format === "story" ? 100 : 72, fontWeight: 800, textAlign: "center" }}>BATTLE YOUR TASTE.</div>, "New music every day.");
}

const pct = (a: number, b: number) => (a + b ? Math.round((a * 100) / (a + b)) : 50);

// ── Wars ───────────────────────────────────────────────────────────────────

export async function warCard(id: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const w = await getWar(getBattleDeps(), null, id).catch(() => null);
  if (!w) return plain(format, f);
  const story = format === "story";
  const [artA, artB] = await Promise.all([artData(w.a.artworkUrl), artData(w.b.artworkUrl)]);
  const overall = w.categories.find((c) => c.key === "overall");
  const closed = w.status === "CLOSED" && overall && overall.a !== null && overall.b !== null;
  const aPct = closed ? pct(overall.a!, overall.b!) : null;
  const size = story ? 400 : 230;
  const side = (s: "A" | "B") => {
    const x = s === "A" ? w.a : w.b;
    const won = w.winner === s;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: story ? 440 : 420, opacity: w.winner && !won && w.winner !== "DRAW" ? 0.6 : 1 }}>
        <Cover url={s === "A" ? artA : artB} size={size} />
        {won ? <div style={{ display: "flex", fontSize: story ? 30 : 20, fontWeight: 800, color: INK, background: SOFT, borderRadius: 999, padding: "6px 20px", letterSpacing: 3 }}>WINNER</div> : null}
        <div style={{ display: "flex", fontSize: story ? 46 : 32, fontWeight: 800, textAlign: "center", justifyContent: "center" }}>{x.title.slice(0, 40)}</div>
        <div style={{ display: "flex", fontSize: story ? 34 : 24, color: MUTED }}>{x.artistName.slice(0, 40)}</div>
        {aPct !== null ? <div style={{ display: "flex", fontSize: story ? 96 : 56, fontWeight: 800, color: won ? SOFT : "white" }}>{`${s === "A" ? aPct : 100 - aPct}%`}</div> : null}
      </div>
    );
  };
  const headline = w.status === "CLOSED" ? (w.winner === "DRAW" ? "Dead even" : `${(w.winner === "A" ? w.a : w.b).title} wins`) : `${w.kind === "ALBUM" ? "Album" : "Single"} war · which wins?`;
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: story ? 60 : 24 }}>
      <div style={{ display: "flex", fontSize: story ? 44 : 30, color: SOFT, fontWeight: 800 }}>{headline}</div>
      <div style={{ display: "flex", flexDirection: story ? "column" : "row", alignItems: "center", gap: story ? 40 : 60 }}>
        {side("A")}
        <div style={{ display: "flex", fontSize: story ? 60 : 40, color: MUTED, fontWeight: 800 }}>VS</div>
        {side("B")}
      </div>
      {w.voters ? <div style={{ display: "flex", fontSize: story ? 32 : 22, color: MUTED }}>{`${w.voters} voter${w.voters === 1 ? "" : "s"}`}</div> : null}
    </div>,
    w.status === "CLOSED" ? "Agree? Start your own war." : "Cast your vote on VYBZ.",
  );
}

// ── Drops ──────────────────────────────────────────────────────────────────

export async function dropCard(id: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const { db } = getBattleDeps();
  const [r] = await db.select().from(schema.release).where(eq(schema.release.id, id));
  if (!r || r.status !== "LIVE") return plain(format, f);
  const [{ n: fires }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.releaseFire).where(eq(schema.releaseFire.releaseId, id))) as [{ n: number }];
  const story = format === "story";
  const kind = r.kind === "SINGLE" ? "New single" : r.kind === "EP" ? "New EP" : r.kind === "MIXTAPE" ? "New mixtape" : "New album";
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: story ? "column" : "row", alignItems: "center", gap: story ? 50 : 48 }}>
      <Cover url={await artData(r.artworkUrl)} size={story ? 760 : 400} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: 14 }}>
        <div style={{ display: "flex", fontSize: story ? 40 : 28, color: SOFT, fontWeight: 800 }}>{kind.toUpperCase()}</div>
        <div style={{ display: "flex", fontSize: story ? 84 : 54, fontWeight: 800, textAlign: story ? "center" : "left", maxWidth: story ? 920 : 640 }}>{r.title.slice(0, 50)}</div>
        <div style={{ display: "flex", fontSize: story ? 44 : 32, color: MUTED }}>{r.artistName.slice(0, 50)}</div>
        {fires ? <div style={{ display: "flex", fontSize: story ? 48 : 32, fontWeight: 800, marginTop: 10 }}>{`${fires} ${fires === 1 ? "fire" : "fires"} on VYBZ`}</div> : null}
      </div>
    </div>,
    "Fire it up on VYBZ.",
  );
}

// ── The weekly chart ───────────────────────────────────────────────────────

export async function chartCard(week: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const c = await chart(getBattleDeps(), null, week === "current" ? null : week).catch(() => null);
  if (!c || !c.rows.length) return plain(format, f);
  const story = format === "story";
  const top = c.rows.slice(0, story ? 8 : 5);
  const arts = await Promise.all(top.map((r) => artData(r.release.artworkUrl)));
  const size = story ? 120 : 64;
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", gap: story ? 26 : 10, width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", marginBottom: story ? 30 : 6 }}>
        <div style={{ display: "flex", fontSize: story ? 72 : 44, fontWeight: 800 }}>THE VYBZ CHART</div>
        <div style={{ display: "flex", fontSize: story ? 36 : 24, color: SOFT, fontWeight: 800 }}>{c.label}</div>
      </div>
      {top.map((r, i) => (
        <div key={r.release.id} style={{ display: "flex", alignItems: "center", gap: story ? 28 : 18 }}>
          <div style={{ display: "flex", width: story ? 80 : 48, fontSize: story ? 56 : 34, fontWeight: 800, color: i === 0 ? SOFT : "white", justifyContent: "flex-end" }}>{String(r.rank)}</div>
          <Cover url={arts[i] ?? null} size={size} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: story ? 40 : 26, fontWeight: 800 }}>{r.release.title.slice(0, 32)}</div>
            <div style={{ display: "flex", fontSize: story ? 30 : 20, color: MUTED }}>{r.release.artistName.slice(0, 36)}</div>
          </div>
          <div style={{ display: "flex", fontSize: story ? 40 : 26, fontWeight: 800, color: SOFT }}>{`${r.score}%`}</div>
        </div>
      ))}
    </div>,
    "Ranked by fans in This or That.",
  );
}

// ── Tournaments and ranks ──────────────────────────────────────────────────

export async function tournamentCard(id: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const t = await getTournament(getBattleDeps(), null, id).catch(() => null);
  if (!t) return plain(format, f);
  const story = format === "story";
  if (t.champion !== null) {
    const c = t.entries[t.champion]!;
    return frame(
      format,
      f,
      <div style={{ display: "flex", flexDirection: story ? "column" : "row", alignItems: "center", gap: story ? 44 : 48 }}>
        <Cover url={await artData(c.artworkUrl)} size={story ? 640 : 380} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: 12 }}>
          <div style={{ display: "flex", fontSize: story ? 38 : 26, color: SOFT, fontWeight: 800, letterSpacing: 3 }}>CHAMPION</div>
          <div style={{ display: "flex", fontSize: story ? 80 : 52, fontWeight: 800, textAlign: story ? "center" : "left" }}>{c.title.slice(0, 40)}</div>
          <div style={{ display: "flex", fontSize: story ? 42 : 30, color: MUTED }}>{c.artistName.slice(0, 40)}</div>
          <div style={{ display: "flex", fontSize: story ? 36 : 24, marginTop: 10 }}>{t.title.slice(0, 60)}</div>
        </div>
      </div>,
      "Run the next bracket on VYBZ.",
    );
  }
  const round = t.rounds.at(-1)!;
  const shown = round.matches.slice(0, story ? 4 : 2);
  const arts = await Promise.all(shown.flatMap((m) => [artData(t.entries[m.a]!.artworkUrl), artData(t.entries[m.b]!.artworkUrl)]));
  const size = story ? 150 : 90;
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: story ? 34 : 14 }}>
      <div style={{ display: "flex", fontSize: story ? 64 : 40, fontWeight: 800, textAlign: "center" }}>{t.title.slice(0, 50)}</div>
      <div style={{ display: "flex", fontSize: story ? 38 : 26, color: SOFT, fontWeight: 800 }}>{round.name.toUpperCase()}</div>
      {shown.map((m, i) => (
        <div key={m.index} style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Cover url={arts[i * 2] ?? null} size={size} />
          <div style={{ display: "flex", fontSize: story ? 36 : 24, color: MUTED, fontWeight: 800 }}>VS</div>
          <Cover url={arts[i * 2 + 1] ?? null} size={size} />
        </div>
      ))}
    </div>,
    "Vote the bracket on VYBZ.",
  );
}

export async function rankCard(handle: string, format: CardFormat): Promise<ImageResponse> {
  const f = await loadFonts();
  const { db } = getBattleDeps();
  const [u] = await db.select().from(schema.user).where(eq(schema.user.handle, handle.toLowerCase()));
  const [r] = u ? await db.select().from(schema.userRating).where(eq(schema.userRating.userId, u.id)) : [];
  if (!u || !r || !r.games) return plain(format, f);
  const v = rankView(r);
  const story = format === "story";
  return frame(
    format,
    f,
    <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", gap: story ? 26 : 12 }}>
      <div style={{ display: "flex", fontSize: story ? 40 : 26, color: SOFT, fontWeight: 800, letterSpacing: 3 }}>{`RANKED · ${v.season}`}</div>
      <div style={{ display: "flex", fontSize: story ? 150 : 96, fontWeight: 800 }}>{v.divisionLabel.toUpperCase()}</div>
      <div style={{ display: "flex", fontSize: story ? 80 : 52, fontWeight: 800 }}>{`${v.rating}`}</div>
      <div style={{ display: "flex", fontSize: story ? 44 : 30, color: MUTED }}>{`@${u.handle} · ${v.wins}-${v.losses}${v.draws ? `-${v.draws}` : ""}`}</div>
    </div>,
    "Think your taste is better? Play ranked.",
  );
}

export async function plainCard(format: CardFormat): Promise<ImageResponse> {
  return plain(format, await loadFonts());
}

export { frame, plain, Cover, VIOLET };
