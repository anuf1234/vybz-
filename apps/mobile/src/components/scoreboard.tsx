import type { BattleView } from "@vybz/core";
import { StyleSheet, Text, View } from "react-native";
import { color, sideColor, space, type } from "./theme";
import { Avatar } from "./ui";

/** Sports-style scoreboard: both sides, rounds won, and a round tracker. */
export function Scoreboard({ battle }: { battle: BattleView }) {
  if (battle.format === "MULTI") return <Standings battle={battle} />;
  const a = battle.participants.find((p) => p.side === 0);
  const b = battle.participants.find((p) => p.side === 1);
  const sideA = a?.user ?? battle.creator;
  const sideB = b?.user ?? battle.invited;
  const final = battle.status === "COMPLETE";
  const scored = battle.rounds.filter((r) => r.status === "SCORED").length;

  return (
    <View style={styles.wrap} accessibilityLabel={`Score ${sideA.handle} ${a?.roundsWon ?? 0}, ${sideB?.handle ?? "open"} ${b?.roundsWon ?? 0}`}>
      <View style={styles.row}>
        <Side name={sideA.displayName} handle={sideA.handle} ring={sideColor(0)} />
        <View style={styles.score}>
          <Text style={[styles.num, final && battle.winnerParticipantId === a?.id && styles.winner]}>{a?.roundsWon ?? 0}</Text>
          <Text style={styles.dash}>–</Text>
          <Text style={[styles.num, final && battle.winnerParticipantId === b?.id && styles.winner]}>{b?.roundsWon ?? 0}</Text>
        </View>
        {sideB ? <Side name={sideB.displayName} handle={sideB.handle} ring={sideColor(1)} /> : <View style={styles.side}><Avatar name="?" size={48} /><Text style={type.small}>Open</Text></View>}
      </View>
      <View style={styles.tracker} accessibilityLabel={`${scored} of ${battle.rounds.length} rounds scored`}>
        {battle.rounds.map((r) => {
          const fill =
            r.status !== "SCORED"
              ? r.index === battle.currentRoundIndex
                ? color.violetSoft
                : color.surface3
              : r.winnerParticipantId === a?.id
                ? color.sideA
                : r.winnerParticipantId === b?.id
                  ? color.sideB
                  : color.lose;
          return <View key={r.index} style={[styles.pip, { backgroundColor: fill }, r.suddenDeath && styles.suddenDeath, r.index === battle.currentRoundIndex && styles.current]} />;
        })}
      </View>
      {battle.aiScorecard && battle.rules.judging.mode === "SEPARATE" ? (
        <Text style={[type.small, { textAlign: "center" }]}>
          AI's card {battle.aiScorecard[a?.id ?? ""] ?? 0}–{battle.aiScorecard[b?.id ?? ""] ?? 0}
        </Text>
      ) : null}
      <Text style={[type.label, { textAlign: "center" }]}>
        {final ? "Final" : battle.currentRoundIndex !== null ? `Round ${battle.currentRoundIndex + 1} / ${battle.rounds.length}${battle.rounds[battle.currentRoundIndex]?.suddenDeath ? " · Sudden death" : ""}` : ""}
      </Text>
    </View>
  );
}

function Side({ name, handle, ring }: { name: string; handle: string; ring: string }) {
  return (
    <View style={styles.side}>
      <Avatar name={name} size={48} ring={ring} />
      <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
        @{handle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingVertical: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  side: { flex: 1, alignItems: "center", gap: space.xs },
  score: { flexDirection: "row", alignItems: "center", gap: space.sm },
  num: { ...type.display, fontSize: 52, lineHeight: 56, fontVariant: ["tabular-nums"] },
  dash: { ...type.display, fontSize: 32, color: color.muted },
  winner: { color: color.win, textShadowColor: "rgba(57,255,136,0.45)", textShadowRadius: 14 },
  tracker: { flexDirection: "row", justifyContent: "center", gap: 6, flexWrap: "wrap" },
  pip: { width: 22, height: 6, borderRadius: 3 },
  current: { height: 8 },
  suddenDeath: { borderWidth: 1, borderColor: color.live },
});

/** Group battles: players ranked by rounds won, plus the round tracker. */
function Standings({ battle }: { battle: BattleView }) {
  const final = battle.status === "COMPLETE";
  const ranked = [...battle.participants].sort((x, y) => y.roundsWon - x.roundsWon || x.side - y.side);
  const openSeats = battle.status === "OPEN_CHALLENGE" ? Math.max(0, battle.entrants.max - battle.participants.length) : 0;
  const current = battle.currentRoundIndex !== null ? battle.rounds[battle.currentRoundIndex] : undefined;
  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm }}>
      {ranked.map((p, i) => {
        const won = final && battle.winnerParticipantId === p.id;
        const out = current?.suddenDeath && !current.contenderIds.includes(p.id);
        return (
          <View key={p.id} style={[stylesM.row, out && { opacity: 0.45 }]} accessibilityLabel={`${i + 1}. ${p.user.handle}, ${p.roundsWon} rounds`}>
            <Text style={[type.display, stylesM.rank]}>{battle.status === "OPEN_CHALLENGE" ? "" : i + 1}</Text>
            <Avatar name={p.user.displayName} size={34} ring={won ? color.win : sideColor(p.side)} />
            <Text style={[type.body, { fontWeight: "700", flex: 1 }]} numberOfLines={1}>
              @{p.user.handle}
              {p.user.id === battle.creator.id ? <Text style={type.small}>  host</Text> : null}
            </Text>
            {battle.status !== "OPEN_CHALLENGE" ? <Text style={[type.display, { fontSize: 26, color: won ? color.win : color.text }]}>{p.roundsWon}</Text> : null}
          </View>
        );
      })}
      {Array.from({ length: openSeats }, (_, i) => (
        <View key={`seat-${i}`} style={[stylesM.row, { opacity: 0.5 }]}>
          <Text style={[type.display, stylesM.rank]} />
          <View style={stylesM.openSeat} />
          <Text style={type.small}>Open seat</Text>
        </View>
      ))}
      {battle.status !== "OPEN_CHALLENGE" ? (
        <>
          <View style={styles.tracker}>
            {battle.rounds.map((r) => {
              const w = battle.participants.find((p) => p.id === r.winnerParticipantId);
              const fill = r.status !== "SCORED" ? (r.index === battle.currentRoundIndex ? color.violetSoft : color.surface3) : w ? sideColor(w.side) : color.lose;
              return <View key={r.index} style={[styles.pip, { backgroundColor: fill }, r.suddenDeath && styles.suddenDeath]} />;
            })}
          </View>
          <Text style={[type.label, { textAlign: "center" }]}>
            {final ? "Final" : current ? `Round ${current.index + 1} / ${battle.rounds.length}${current.suddenDeath ? " · Sudden death" : ""}` : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const stylesM = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface1, borderRadius: 12, borderWidth: 1, borderColor: color.line, paddingVertical: 8, paddingHorizontal: space.md },
  rank: { width: 22, fontSize: 20, textAlign: "center" },
  openSeat: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderStyle: "dashed", borderColor: color.line },
});
