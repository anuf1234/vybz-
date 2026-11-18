import { PARTY_GAMES, type PartyGame, normalizePartyCode } from "@vybz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Share, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { API_URL } from "@/lib/config";

/** Vybz Party Mode: host on a TV or laptop, everyone plays on their phone. */
export default function Party() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hostUrl = `${API_URL}/party`;

  const join = () => {
    const c = normalizePartyCode(code);
    if (!c) return setError("Codes look like VYBZ-4821.");
    setError(null);
    router.push({ pathname: "/party/play", params: { path: `/p/${c}`, title: `VYBZ-${c}` } });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { fontSize: 30 }]}>PARTY MODE</Text>
        <Text style={type.small}>Birthdays, cookouts, game night, family reunions: one screen hosts, everyone plays on their phone.</Text>
      </View>

      <Card style={{ gap: space.md }}>
        <Text style={type.label}>Join a party</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          onSubmitEditing={join}
          placeholder="VYBZ-4821"
          placeholderTextColor={color.lose}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Party code"
          style={{ backgroundColor: color.surface2, borderColor: color.line, borderWidth: 1, borderRadius: radius.md, padding: space.lg, color: color.text, fontSize: 26, textAlign: "center", letterSpacing: 3, fontWeight: "800" }}
        />
        <Button title="Join" onPress={join} disabled={!code.trim()} />
        <Text style={type.small}>Or scan the QR code on the host's screen with your camera. Joining here earns you XP.</Text>
        {error ? <ErrorBanner message={error} /> : null}
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={type.label}>Host a party</Text>
        <Text style={type.body}>
          On a TV or laptop, open <Text style={{ fontWeight: "800" }}>{hostUrl.replace(/^https?:\/\//, "")}</Text>. Guests don't need the app or an account.
        </Text>
        <Button title="Send the host link" kind="secondary" onPress={() => void Share.share({ message: `Host a VYBZ party on your TV: ${hostUrl}`, url: hostUrl })} />
        <Button title="Host from this phone" kind="ghost" onPress={() => router.push({ pathname: "/party/play", params: { path: "/party", title: "Host a party" } })} />
      </Card>

      <View style={{ gap: space.sm }}>
        <Text style={type.label}>Games</Text>
        {(Object.keys(PARTY_GAMES) as PartyGame[]).map((g) => (
          <View key={g} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <Text style={{ fontSize: 22 }}>{PARTY_GAMES[g].icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>{PARTY_GAMES[g].label}</Text>
              <Text style={type.small}>{g === "FINISH_THE_LYRICS" ? "Coming once VYBZ has a lyrics licence." : g === "DJ_SHOWDOWN" ? "Coming soon. For now, try DJ battles." : PARTY_GAMES[g].blurb}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
