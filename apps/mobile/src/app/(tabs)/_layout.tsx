import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { InboxButton } from "@/components/inbox-button";
import { NotificationBell } from "@/components/notification-bell";
import { RankingsButton } from "@/components/rankings-button";
import type { ColorValue } from "react-native";
import { color } from "@/components/theme";

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => ({ color: c, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={c as string} size={size} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: color.ink },
        headerTintColor: color.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: color.surface1, borderTopColor: color.line },
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.muted,
        sceneStyle: { backgroundColor: color.ink },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: "VYBZ", tabBarIcon: icon("flame"), headerRight: () => <NotificationBell />, headerLeft: () => <RankingsButton /> }} />
      <Tabs.Screen name="battles" options={{ title: "Battles", tabBarIcon: icon("flash") }} />
      <Tabs.Screen name="play" options={{ title: "Play", tabBarIcon: icon("game-controller") }} />
      {/* Custom battles open from Play and Battles; no tab of their own. */}
      <Tabs.Screen name="create" options={{ title: "Custom battle", href: null }} />
      <Tabs.Screen name="feed" options={{ title: "Feed", tabBarIcon: icon("people"), headerRight: () => <InboxButton /> }} />
      <Tabs.Screen name="library" options={{ title: "Library", tabBarIcon: icon("library") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
