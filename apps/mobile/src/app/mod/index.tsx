import type { ModerationAction, ModerationReportView } from "@vybz/core";
import { Link } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Button, Card, EmptyState, ErrorBanner, Loading, Pill, Segmented } from "@/components/ui";
import { ApiRequestError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

type Status = "OPEN" | "ACTIONED" | "DISMISSED";

const ACTIONS: Record<ModerationReportView["subjectType"], { action: ModerationAction; label: string; kind: "danger" | "secondary" }[]> = {
  CHAT_MESSAGE: [{ action: "HIDE_MESSAGE", label: "Hide message", kind: "danger" }],
  BATTLE: [{ action: "VOID_BATTLE", label: "Void battle", kind: "danger" }],
  USER: [{ action: "SUSPEND_USER", label: "Suspend user", kind: "danger" }],
  POST: [
    { action: "HIDE_MESSAGE", label: "Hide post", kind: "danger" },
    { action: "SUSPEND_USER", label: "Suspend author", kind: "secondary" },
  ],
  COMMENT: [
    { action: "HIDE_MESSAGE", label: "Hide comment", kind: "danger" },
    { action: "SUSPEND_USER", label: "Suspend author", kind: "secondary" },
  ],
  DIRECT_MESSAGE: [
    { action: "HIDE_MESSAGE", label: "Hide message", kind: "danger" },
    { action: "SUSPEND_USER", label: "Suspend sender", kind: "secondary" },
  ],
};

/** Staff only: the server returns 403 to everyone else. */
export default function ModerationQueue() {
  const [status, setStatus] = useState<Status>("OPEN");
  const reports = useResource(() => api.modReports(status), [status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (r: ModerationReportView, action: ModerationAction) => {
    setBusy(`${r.id}:${action}`);
    setError(null);
    try {
      await api.resolveReport(r.id, action);
      await reports.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl tintColor={color.violet} refreshing={reports.refreshing} onRefresh={() => void reports.reload()} />}
    >
      <Link href="/mod/trivia" asChild>
        <Button title="🧠 Trivia questions" kind="secondary" />
      </Link>
      <Link href="/mod/metrics" asChild>
        <Button title="📈 Growth metrics" kind="secondary" />
      </Link>
      <Link href="/mod/data" asChild>
        <Button title="🗄️ Partner data" kind="secondary" />
      </Link>
      <Link href="/mod/artists" asChild>
        <Button title="🎤 Artist profiles" kind="secondary" />
      </Link>
      <Link href="/mod/mixtapes" asChild>
        <Button title="📼 Mixtapes and drops" kind="secondary" />
      </Link>
      <Segmented
        value={status}
        onChange={(v) => setStatus(v as Status)}
        options={[
          { value: "OPEN", label: "Open" },
          { value: "ACTIONED", label: "Actioned" },
          { value: "DISMISSED", label: "Dismissed" },
        ]}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {reports.error ? (
        <ErrorBanner message={reports.error.status === 403 ? "Moderators only." : reports.error.message} onRetry={() => void reports.reload()} />
      ) : null}
      {!reports.data && !reports.error ? <Loading /> : null}
      {reports.data && !reports.data.items.length ? <EmptyState title="Queue is clear" body="Nothing reported right now." /> : null}
      {reports.data?.items.map((r) => (
        <Card key={r.id}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
            <Pill text={r.subjectType.replace("_", " ").toLowerCase()} tone="violet" />
            {r.reportCount > 1 ? <Pill text={`${r.reportCount} reports`} tone="live" /> : null}
            <Text style={type.small}>by @{r.reporter.handle}</Text>
          </View>
          {r.context.text ? <Text style={[type.body, { fontStyle: "italic" }]}>"{r.context.text}"</Text> : null}
          {r.context.user ? <Text style={type.small}>User: @{r.context.user.handle}</Text> : null}
          {r.context.postId ? (
            <Link href={{ pathname: "/post/[id]", params: { id: r.context.postId } }}>
              <Text style={[type.small, { color: color.violet }]}>Open the post</Text>
            </Link>
          ) : null}
          {r.context.battleId ? (
            <Link href={{ pathname: "/battle/[id]", params: { id: r.context.battleId } }}>
              <Text style={[type.small, { color: color.violet }]}>Battle: {r.context.battleTitle ?? r.context.battleId}</Text>
            </Link>
          ) : null}
          <Text style={type.small}>Reason: {r.reason}</Text>
          {status === "OPEN" ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {ACTIONS[r.subjectType].map((a) => (
                <Button key={a.action} title={a.label} kind={a.kind} style={{ flex: 1 }} loading={busy === `${r.id}:${a.action}`} onPress={() => void resolve(r, a.action)} />
              ))}
              <Button title="Dismiss" kind="ghost" style={{ flex: 1 }} loading={busy === `${r.id}:DISMISS`} onPress={() => void resolve(r, "DISMISS")} />
            </View>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}
