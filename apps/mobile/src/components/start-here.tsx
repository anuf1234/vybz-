import type { OnboardingState } from "@vybz/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, space, type } from "./theme";
import { Button, Card } from "./ui";
import { api } from "@/lib/api";

/** Home's first-run card: two steps, then it goes away. Opens the welcome flow once for brand-new players. */
export function StartHere({ onState }: { onState?: (s: OnboardingState | null) => void }) {
  const router = useRouter();
  const [s, setS] = useState<OnboardingState | null>(null);
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.onboarding().then(
        (o) => {
          if (!alive) return;
          setS(o);
          onState?.(o);
          if (o.active && o.next === "genres" && !opened.current) {
            opened.current = true;
            router.push("/welcome");
          }
        },
        () => onState?.(null),
      );
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  if (!s) return null;
  if (s.bonus) {
    return (
      <Card style={{ gap: space.xs, borderColor: color.win }}>
        <Text style={[type.heading, { color: color.win }]}>
          👋 Welcome bonus: +{s.bonus.xp} XP, +{s.bonus.coins} coins
        </Text>
        <Text style={type.small}>You've played your first battle and your first daily trivia. Come back tomorrow to keep your streaks going.</Text>
      </Card>
    );
  }
  if (!s.active) return null;
  const Step = ({ n, done, label, action }: { n: number; done: boolean; label: string; action?: () => void }) => (
    <Pressable
      onPress={action}
      disabled={done || !action}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
      accessibilityRole="button"
      accessibilityState={{ checked: done }}
    >
      <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: done ? color.win : color.surface3 }}>
        <Text style={{ color: done ? color.ink : color.text, fontWeight: "900" }}>{done ? "✓" : n}</Text>
      </View>
      <Text style={[type.body, { flex: 1, fontWeight: "700" }, done && { color: color.muted, textDecorationLine: "line-through" }]}>{label}</Text>
    </Pressable>
  );
  const nextAction = s.next === "trivia" ? () => router.push("/trivia") : () => router.push("/welcome");
  return (
    <Card style={{ gap: space.md, borderColor: color.violet }}>
      <Text style={type.label}>Start here</Text>
      <Step n={1} done={s.steps.battle} label="Play your first quick battle" action={() => router.push("/welcome")} />
      <Step n={2} done={s.steps.trivia} label="Do today's trivia" action={() => router.push("/trivia")} />
      <Button title={s.next === "trivia" ? "🧠 Play today's trivia" : "⚡ Play my first battle"} onPress={nextAction} />
      <Text style={type.small}>Finish both for a welcome bonus of 50 XP and 25 coins.</Text>
    </Card>
  );
}
