import { useState } from "react";
import { RefreshControl, ScrollView, Text } from "react-native";
import { color, space, type } from "@/components/theme";
import { EmptyState, ErrorBanner, Loading, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { BattleRow } from "@/components/dj-battle-row";

type S = "VOTING" | "OPEN" | "COMPLETE";

export default function DjBattles() {
  const [status, setStatus] = useState<S>("VOTING");
  const list = useResource(() => api.djBattles(status), [status]);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl tintColor={color.violet} refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: "VOTING", label: "Vote" },
          { value: "OPEN", label: "Open" },
          { value: "COMPLETE", label: "Results" },
        ]}
      />
      {list.error ? <ErrorBanner message={list.error.message} onRetry={() => void list.reload()} /> : null}
      {!list.data ? <Loading /> : null}
      {list.data && !list.data.items.length ? <EmptyState title="Nothing here yet" body="Record a battle set in the studio and start a DJ battle." /> : null}
      {list.data?.items.map((b) => (
        <BattleRow
          key={b.id}
          id={b.id}
          title={b.title}
          a={b.a.dj.handle}
          b={b.b?.dj.handle ?? null}
          note={b.status === "COMPLETE" ? (b.winner === "DRAW" ? `Draw · ${b.a.votes}–${b.b?.votes}` : `@${(b.winner === "A" ? b.a : b.b!).dj.handle} won ${b.a.votes}–${b.b?.votes}`) : b.status === "OPEN" ? "Waiting for a challenger" : "Voting open"}
        />
      ))}
      <Text style={[type.small, { textAlign: "center" }]}>Battle sets use the VYBZ pack, so every listener hears exactly what the DJ played.</Text>
    </ScrollView>
  );
}
