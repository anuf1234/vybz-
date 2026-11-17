import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { type Terms, TermsForm, rulesToTerms, termsToRules } from "@/components/terms-form";
import { space, type } from "@/components/theme";
import { Button, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** Send different terms back: the other side then accepts or counters. */
export default function Counter() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const battle = useResource(() => api.battle(id), [id]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (battle.data && !terms) setTerms(rulesToTerms(battle.data.rules));
  }, [battle.data, terms]);

  if (!battle.data || !terms) return battle.error ? <ErrorBanner message={battle.error.message} /> : <Loading />;
  const b = battle.data;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.counter(id, termsToRules(terms!, b.rules));
      router.back();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send the counter-offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
      <Stack.Screen options={{ title: "Counter-offer" }} />
      <Text style={type.small}>Change anything you want. @{b.terms.proposedBy.handle} gets to accept your terms or counter again.</Text>
      <TermsForm value={terms} onChange={setTerms} mode="counter" />
      {error ? <ErrorBanner message={error} /> : null}
      <Button title="Send counter-offer" onPress={() => void send()} loading={busy} />
    </ScrollView>
  );
}
