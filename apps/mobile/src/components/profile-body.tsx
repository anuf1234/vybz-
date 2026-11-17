import type { ProfileView } from "@vybz/core";
import { StyleSheet, Text, View } from "react-native";
import { BattleCard } from "./battle-card";
import { color, space, type } from "./theme";
import { Avatar, Card, SectionTitle } from "./ui";

export function ProfileBody({ profile, now }: { profile: ProfileView; now: number }) {
  const { user, record } = profile;
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.header}>
        <Avatar name={user.displayName} image={user.image} size={72} ring={color.violet} />
        <Text style={type.title}>{user.displayName}</Text>
        <Text style={type.small}>@{user.handle}</Text>
      </View>
      <Card style={styles.stats}>
        <Stat label="Wins" value={record.wins} highlight />
        <Stat label="Losses" value={record.losses} />
        <Stat label="Draws" value={record.draws} />
        <Stat label="Rounds" value={record.roundsWon} />
      </Card>
      {profile.recent.length ? <SectionTitle>Recent battles</SectionTitle> : null}
      {profile.recent.map((b) => (
        <BattleCard key={b.id} battle={b} now={now} />
      ))}
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={[type.display, { fontSize: 30, color: highlight ? color.violetSoft : color.text }]}>{value}</Text>
      <Text style={type.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: space.xs, paddingVertical: space.md },
  stats: { flexDirection: "row", justifyContent: "space-between" },
});
