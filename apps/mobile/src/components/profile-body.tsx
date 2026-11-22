import { frameColor } from "@vybz/core";
import type { ProfileView } from "@vybz/core";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AchievementStrip } from "./achievement-strip";
import { BattleCard } from "./battle-card";
import { ProgressCard } from "./progress-card";
import { color, space, type } from "./theme";
import { Avatar, Card, SectionTitle } from "./ui";

export function ProfileBody({ profile, now, actions }: { profile: ProfileView; now: number; actions?: React.ReactNode }) {
  const { user, record } = profile;
  const router = useRouter();
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.header}>
        <Avatar name={user.displayName} image={user.image} size={72} ring={frameColor(user.frame) ?? color.violet} />
        <Text style={type.title}>{user.displayName}</Text>
        <Text style={type.small}>
          @{user.handle}
          {profile.pro ? <Text style={{ color: color.violetSoft, fontWeight: "800" }}>  ✨ Pro</Text> : null}
        </Text>
        {profile.artist ? (
          <Pressable onPress={() => router.push({ pathname: "/artist/[name]", params: { name: profile.artist!.name } })} accessibilityRole="link" accessibilityLabel={`Verified artist ${profile.artist.name}. Open artist page.`}>
            <Text style={[type.small, { color: color.violetSoft, fontWeight: "800" }]}>✓ Verified artist: {profile.artist.name} ›</Text>
          </Pressable>
        ) : null}
        {profile.rank ? (
          <Pressable onPress={() => router.push("/ranked")} accessibilityRole="link" accessibilityLabel={`Ranked ${profile.rank.divisionLabel}, ${profile.rank.rating}`}>
            <Text style={[type.small, { fontWeight: "800", color: color.text }]}>
              {profile.rank.icon} {profile.rank.placement ? "Placement" : profile.rank.divisionLabel} · {profile.rank.rating}
            </Text>
          </Pressable>
        ) : null}
        {profile.league || profile.seasonBadges?.length ? (
          <Text style={[type.small, { fontWeight: "700" }]}>
            {profile.league ? `${profile.league.icon} ${profile.league.label} league` : ""}
            {profile.league && profile.seasonBadges?.length ? "  ·  " : ""}
            {profile.seasonBadges?.map((b) => `${b.icon} ${b.season.replace("-", " ")}`).join("  ")}
          </Text>
        ) : null}
        <View style={styles.counts}>
          <Count label="Followers" value={profile.social.followers} onPress={() => router.push({ pathname: "/user/[handle]/follows", params: { handle: user.handle, which: "followers" } })} />
          <Count label="Following" value={profile.social.following} onPress={() => router.push({ pathname: "/user/[handle]/follows", params: { handle: user.handle, which: "following" } })} />
          <Count label="Posts" value={profile.social.posts} />
        </View>
      </View>
      {actions}
      <Card style={styles.stats}>
        <Stat label="Wins" value={record.wins} highlight />
        <Stat label="Losses" value={record.losses} />
        <Stat label="Draws" value={record.draws} />
        <Stat label="Rounds" value={record.roundsWon} />
      </Card>
      <ProgressCard handle={user.handle} />
      <AchievementStrip handle={user.handle} />
      {profile.recent.length ? <SectionTitle>Recent battles</SectionTitle> : null}
      {profile.recent.map((b) => (
        <BattleCard key={b.id} battle={b} now={now} />
      ))}
    </View>
  );
}

function Count({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ alignItems: "center", minWidth: 72 }} accessibilityRole={onPress ? "link" : undefined} accessibilityLabel={`${value} ${label}`}>
      <Text style={[type.heading, { fontWeight: "800" }]}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </Pressable>
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
  counts: { flexDirection: "row", gap: space.lg, marginTop: space.sm },
});
