import type { BattleView } from "@vybz/core";
import { StyleSheet, Text, View } from "react-native";
import { color, space, type } from "./theme";
import { Avatar } from "./ui";

/** Sports-style scoreboard: both sides, rounds won, and a round tracker. */
export function Scoreboard({ battle }: { battle: BattleView }) {
  const a = battle.participants.find((p) => p.side === 0);
  const b = battle.participants.find((p) => p.side === 1);
  const sideA = a?.user ?? battle.creator;
  const sideB = b?.user ?? battle.invited;
  const final = battle.status === "COMPLETE";
  const scored = battle.rounds.filter((r) => r.status === "SCORED").length;

  return (
    <View style={styles.wrap} accessibilityLabel={`Score ${sideA.handle} ${a?.roundsWon ?? 0}, ${sideB?.handle ?? "open"} ${b?.roundsWon ?? 0}`}>
      <View style={styles.row}>
        <Side name={sideA.displayName} handle={sideA.handle} ring={color.sideA} />
        <View style={styles.score}>
          <Text style={[styles.num, final && battle.winnerParticipantId === a?.id && styles.winner]}>{a?.roundsWon ?? 0}</Text>
          <Text style={styles.dash}>–</Text>
          <Text style={[styles.num, final && battle.winnerParticipantId === b?.id && styles.winner]}>{b?.roundsWon ?? 0}</Text>
        </View>
        {sideB ? <Side name={sideB.displayName} handle={sideB.handle} ring={color.sideB} /> : <View style={styles.side}><Avatar name="?" size={48} /><Text style={type.small}>Open</Text></View>}
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
