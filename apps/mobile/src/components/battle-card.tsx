import type { BattleListItem, ViewerAction } from "@vybz/core";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { countdown, roundPhase, STATUS_LABEL } from "@/lib/format";
import { color, radius, sideColor, space, type } from "./theme";
import { Avatar, Pill } from "./ui";

const ACTION_LABEL: Record<ViewerAction, string | null> = {
  accept: "Accept",
  join: "Join",
  submit: "Your pick",
  vote: "Vote",
  wait: null,
  none: null,
};

export function BattleCard({ battle, now }: { battle: BattleListItem; now: number }) {
  const [a, b] = [battle.participants.find((p) => p.side === 0), battle.participants.find((p) => p.side === 1)];
  const live = battle.status === "IN_PROGRESS";
  const left = countdown(battle.deadline, now);
  const action = ACTION_LABEL[battle.viewerAction];
  const sideA = a?.user ?? battle.creator;
  const sideB = b?.user ?? battle.invited;
  const winner = battle.winnerParticipantId;
  const started = battle.status === "IN_PROGRESS" || battle.status === "COMPLETE";

  return (
    <Link href={{ pathname: "/battle/[id]", params: { id: battle.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="link" accessibilityLabel={`${battle.title}, ${STATUS_LABEL[battle.status]}`}>
        <View style={styles.top}>
          <Pill text={live ? `Round ${(battle.currentRoundIndex ?? 0) + 1}/${battle.roundCount} · ${roundPhase(battle.currentRoundStatus)}` : STATUS_LABEL[battle.status]} tone={live ? "live" : "default"} />
          {action ? <Pill text={action} tone="violet" /> : left && live ? <Text style={type.small}>{left}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Text style={[type.heading, { flexShrink: 1 }]} numberOfLines={1}>
            {battle.title}
          </Text>
          {battle.visibility === "PRIVATE" ? <Text style={type.small}>🔒</Text> : null}
          {battle.featured ? <Pill text="Featured" tone="violet" /> : null}
        </View>
        {battle.theme ? <Text style={type.small}>{battle.theme}</Text> : null}
        {battle.format === "MULTI" ? (
          <View style={styles.group}>
            {battle.participants.map((p) => (
              <View key={p.id} style={{ alignItems: "center", gap: 2 }}>
                <Avatar name={p.user.displayName} size={30} ring={winner === p.id ? color.win : sideColor(p.side)} />
                {started ? <Text style={[type.small, { fontSize: 11 }]}>{p.roundsWon}</Text> : null}
              </View>
            ))}
            {Array.from({ length: Math.max(0, battle.maxEntrants - battle.participants.length) }, (_, i) => (
              <View key={`open-${i}`} style={styles.openSeat} />
            ))}
            <Text style={[type.small, { marginLeft: "auto" }]}>
              {battle.participants.length}/{battle.maxEntrants} players
            </Text>
          </View>
        ) : (
        <View style={styles.vs}>
          <Side name={sideA.displayName} handle={sideA.handle} score={started ? a?.roundsWon : undefined} ring={color.sideA} won={!!winner && winner === a?.id} />
          <Text style={styles.vsText}>VS</Text>
          {sideB ? (
            <Side name={sideB.displayName} handle={sideB.handle} score={started ? b?.roundsWon : undefined} ring={color.sideB} won={!!winner && winner === b?.id} alignEnd />
          ) : (
            <View style={[styles.side, { alignItems: "flex-end" }]}>
              <Text style={type.small}>Open to anyone</Text>
            </View>
          )}
        </View>
        )}
      </Pressable>
    </Link>
  );
}

function Side({ name, handle, score, ring, won, alignEnd }: { name: string; handle: string; score?: number; ring: string; won?: boolean; alignEnd?: boolean }) {
  return (
    <View style={[styles.side, alignEnd && { flexDirection: "row-reverse" }]}>
      <Avatar name={name} size={34} ring={ring} />
      <View style={{ alignItems: alignEnd ? "flex-end" : "flex-start", flexShrink: 1 }}>
        <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={1}>
          @{handle}
        </Text>
        {score !== undefined ? <Text style={[type.display, { fontSize: 22, color: won ? color.win : color.text }]}>{score}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: space.lg, gap: space.sm },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  vs: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm, gap: space.sm },
  vsText: { ...type.display, fontSize: 16, color: color.muted },
  side: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm },
  group: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm, flexWrap: "wrap" },
  openSeat: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderStyle: "dashed", borderColor: color.line },
});
