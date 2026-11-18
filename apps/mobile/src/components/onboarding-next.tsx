import type { OnboardingState } from "@vybz/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { color, space, type } from "./theme";
import { Button, Card } from "./ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

/**
 * Nudges a new player to the next first-run step: after their first battle,
 * today's trivia; when the path is done (whichever step was last), the welcome bonus.
 */
export function OnboardingNext({ when }: { when: "trivia" | "bonus" }) {
  const router = useRouter();
  const session = useSession();
  const [s, setS] = useState<OnboardingState | null>(null);
  useEffect(() => {
    if (!session.data) return;
    void api.onboarding().then(setS, () => undefined);
  }, [session.data]);
  if (!s) return null;
  if (when === "trivia" && s.active && s.next === "trivia") {
    return (
      <Card style={{ gap: space.sm, borderColor: color.violet, backgroundColor: color.plum }}>
        <Text style={type.label}>Next step</Text>
        <Text style={type.heading}>Now try today's trivia</Text>
        <Text style={type.small}>Ten quick questions. Finish it for your welcome bonus.</Text>
        <Button title="🧠 Play today's trivia" onPress={() => router.push("/trivia")} />
      </Card>
    );
  }
  if (s.bonus) {
    return (
      <Card style={{ gap: space.xs, borderColor: color.win }}>
        <Text style={[type.heading, { color: color.win }]}>👋 Welcome bonus: +{s.bonus.xp} XP, +{s.bonus.coins} coins</Text>
        <Text style={type.small}>First battle and first trivia done. You're all set.</Text>
      </Card>
    );
  }
  return null;
}
