import { useState } from "react";
import { Alert } from "react-native";
import { ApiRequestError, api } from "@/lib/api";
import { Button } from "./ui";

export function FollowButton({ handle, following, onChange, compact }: { handle: string; following: boolean; onChange?: (now: boolean) => void; compact?: boolean }) {
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await api.unfollow(handle);
      else await api.follow(handle);
      setOn(!on);
      onChange?.(!on);
    } catch (err) {
      Alert.alert("Couldn't update", err instanceof ApiRequestError ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      title={on ? "Following" : "Follow"}
      kind={on ? "secondary" : "primary"}
      loading={busy}
      onPress={() => void toggle()}
      accessibilityLabel={on ? `Unfollow @${handle}` : `Follow @${handle}`}
      style={compact ? { paddingVertical: 6, paddingHorizontal: 14, minHeight: 34 } : undefined}
    />
  );
}
