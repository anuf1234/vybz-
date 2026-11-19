import { PRO } from "@vybz/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Text, View } from "react-native";
import { color, radius, space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Loading } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { API_URL } from "@/lib/config";
import { setProStatus, usePro } from "@/lib/pro";
import { type StoreProduct, buy, finish, loadProducts, ownedSubscriptions, storeAvailable } from "@/lib/store";

const PERKS = [
  { icon: "🎓", title: "All 11 DJ University courses", body: "Beatmatching, EQ, transitions, phrasing, effects, set building and battle prep. The first two stay free." },
  { icon: "🧊", title: `${PRO.monthlyFreezes} streak freezes every month`, body: "Miss a day without losing your VYBZ streak." },
  { icon: "✨", title: "Pro badge", body: "Shown on your profile." },
];

/** VYBZ Pro: the monthly subscription. Bought through the App Store; the server verifies it with Apple. */
export default function Pro() {
  const router = useRouter();
  const session = useSession();
  const { status } = usePro();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    void loadProducts(status.productIds)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [status?.productIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.data) return <ErrorBanner message="Sign in to get VYBZ Pro." />;
  if (!status) return <Loading />;
  const userId = session.data.user.id;
  const product = products?.[0];

  const claim = async (transactionId: string) => {
    const s = await api.claimPro(transactionId);
    setProStatus(userId, s);
    return s;
  };

  const subscribe = async () => {
    if (!product) return;
    setBusy("buy");
    setError(null);
    try {
      const p = await buy(product.id, status.appAccountToken);
      if (!p) return;
      const s = await claim(p.id);
      await finish(p);
      if (s.active) Alert.alert("Welcome to VYBZ Pro", "All of DJ University is unlocked.", [{ text: "Let's go", onPress: () => router.back() }]);
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "The purchase didn't go through.");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("restore");
    setError(null);
    try {
      const owned = await ownedSubscriptions(status.productIds);
      if (!owned.length) return Alert.alert("Nothing to restore", "We couldn't find a VYBZ Pro subscription on this Apple ID.");
      const s = await claim(owned[0]!.id);
      await Promise.all(owned.map(finish));
      Alert.alert(s.active ? "Restored" : "Subscription ended", s.active ? "VYBZ Pro is on." : "That subscription has expired.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "VYBZ Pro" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
        <Text style={[type.display, { fontSize: 32 }]}>VYBZ PRO</Text>
        {PERKS.map((p) => (
          <View key={p.title} style={{ flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface1 }}>
            <Text style={{ fontSize: 26 }}>{p.icon}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.body, { fontWeight: "800" }]}>{p.title}</Text>
              <Text style={type.small}>{p.body}</Text>
            </View>
          </View>
        ))}

        {status.active ? (
          <Card style={{ gap: space.sm, borderColor: color.violet }}>
            <Text style={[type.body, { fontWeight: "800" }]}>✨ You have VYBZ Pro</Text>
            <Text style={type.small}>
              {status.source === "STAFF"
                ? "Included with your staff account."
                : status.expiresAt
                  ? `${status.willRenew ? "Renews" : "Ends"} ${new Date(status.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`
                  : ""}
            </Text>
            {status.source === "APPLE" && Platform.OS === "ios" ? <Button title="Manage subscription" kind="secondary" onPress={() => void Linking.openURL("https://apps.apple.com/account/subscriptions")} /> : null}
          </Card>
        ) : !storeAvailable ? (
          <Card>
            <Text style={type.small}>Subscribe in the VYBZ iPhone app. Your Pro works everywhere you sign in.</Text>
          </Card>
        ) : !status.configured ? (
          <Card>
            <Text style={type.small}>VYBZ Pro is coming soon.</Text>
          </Card>
        ) : products === null ? (
          <Loading />
        ) : !product ? (
          <Card>
            <Text style={type.small}>VYBZ Pro isn't available in the App Store right now. Try again later.</Text>
          </Card>
        ) : (
          <>
            <Button title={busy === "buy" ? "Opening the App Store…" : `Subscribe for ${product.price}/month`} disabled={busy !== null} onPress={() => void subscribe()} />
            <Text style={[type.small, { textAlign: "center" }]}>
              {product.price} a month. Payment is charged to your Apple ID when you confirm. The subscription renews automatically unless you turn off auto-renew at least 24 hours before the end of the current period; your account is charged for renewal within 24 hours before it ends. Manage or cancel any time in your App Store account settings.
            </Text>
          </>
        )}
        {error ? <ErrorBanner message={error} /> : null}
        {storeAvailable && !status.active && status.configured ? <Button title={busy === "restore" ? "Restoring…" : "Restore purchases"} kind="ghost" disabled={busy !== null} onPress={() => void restore()} /> : null}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg }}>
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void Linking.openURL(`${API_URL}/terms`)} accessibilityRole="link">
            Terms
          </Text>
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")} accessibilityRole="link">
            Terms of Use (EULA)
          </Text>
          <Text style={[type.small, { color: color.violetSoft }]} onPress={() => void Linking.openURL(`${API_URL}/privacy`)} accessibilityRole="link">
            Privacy
          </Text>
        </View>
      </ScrollView>
    </>
  );
}
