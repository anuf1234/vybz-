import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { ProfileBody } from "@/components/profile-body";
import { space } from "@/components/theme";
import { ErrorBanner, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/use-resource";

export default function UserProfile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const prof = useResource(() => api.profile(handle), [handle]);
  const now = useNow(5000);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: `@${handle}` }} />
      {prof.error ? <ErrorBanner message={prof.error.message} onRetry={() => void prof.reload()} /> : null}
      {prof.data ? <ProfileBody profile={prof.data} now={now} /> : prof.loading ? <Loading /> : null}
    </ScrollView>
  );
}
