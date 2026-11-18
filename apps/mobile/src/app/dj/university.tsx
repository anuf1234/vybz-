import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Every DJ University course, in order, with your progress. */
export default function University() {
  const router = useRouter();
  const uni = useResource(() => api.djUniversity(), []);
  useFocusEffect(
    useCallback(() => {
      void uni.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  if (uni.error && !uni.data) return <ErrorBanner message={uni.error.status === 401 ? "Sign in to take DJ University." : uni.error.message} onRetry={() => void uni.reload()} />;
  if (!uni.data) return <Loading />;
  const u = uni.data;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={uni.refreshing} onRefresh={() => void uni.reload()} />}>
      <Text style={type.small}>Each lesson: learn it, watch a demo, practise it in the studio, pass a quick quiz, earn XP.</Text>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: color.surface3, overflow: "hidden" }} accessibilityLabel={`${u.completed} of ${u.total} courses complete`}>
        <View style={{ height: 8, width: `${(100 * u.completed) / u.total}%`, backgroundColor: color.win }} />
      </View>
      {u.lessons.map((l) => {
        const p = l.progress;
        const steps = [p.learned, p.watched, p.practiced, (p.quizScore ?? 0) >= 2];
        return (
          <Pressable
            key={l.id}
            onPress={() => router.push({ pathname: "/dj/lesson/[id]", params: { id: l.id } })}
            style={({ pressed }) => [{ flexDirection: "row", gap: space.md, alignItems: "center", padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: p.completed ? color.win : color.line, backgroundColor: color.surface1 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={`${l.order}. ${l.course}: ${l.title}${p.completed ? ", complete" : ""}`}
          >
            <Text style={{ fontSize: 28 }}>{l.icon}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.label}>
                {l.order}. {l.course}
              </Text>
              <Text style={type.heading}>{l.title}</Text>
              <Text style={type.small} numberOfLines={2}>
                {l.summary}
              </Text>
              <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                {steps.map((d, i) => (
                  <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: d ? color.violet : color.surface3 }} />
                ))}
              </View>
            </View>
            <Text style={[type.small, { color: p.completed ? color.win : color.violetSoft, fontWeight: "700" }]}>{p.completed ? "✓" : `+${l.xp} XP`}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
