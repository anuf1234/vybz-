import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, Text } from "react-native";
import { space, type } from "@/components/theme";
import { Button, Card, ErrorBanner, Segmented } from "@/components/ui";
import { requestText } from "@/lib/api";
import { API_URL } from "@/lib/config";

type Range = "7" | "30" | "90" | "365";
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Staff: partner data. Per-release daily totals (fires, This-or-That wins,
 * Apple Music plays, listens by service) and award history, as CSV
 * spreadsheets to share with labels, brands or buyers. Totals only, never
 * who anyone is.
 */
export default function PartnerData() {
  const [range, setRange] = useState<Range>("30");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportCsv = async (kind: "releases" | "awards") => {
    setBusy(kind);
    setError(null);
    try {
      const path = `/api/v1/mod/data/${kind}?format=csv${kind === "releases" ? `&from=${day(Number(range) - 1)}&to=${day(0)}` : ""}`;
      if (Platform.OS === "web") {
        window.open(`${API_URL}${path}`, "_blank");
        return;
      }
      const csv = await requestText(path);
      const dir = new Directory(Paths.cache, "exports");
      if (!dir.exists) dir.create({ intermediates: true });
      const file = new File(dir, `vybz-${kind}-${day(0)}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "VYBZ data" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Partner data" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
        <Text style={type.small}>
          Totals per release per day, never shown in the app: heat, fires, This-or-That wins and matchups, verified Apple Music plays, and listens by service (Spotify, Apple Music, YouTube, other). Counts of people only; nothing identifies anyone.
        </Text>
        <Card style={{ gap: space.sm }}>
          <Text style={[type.body, { fontWeight: "800" }]}>Release stats by day</Text>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "365", label: "1 year" },
            ]}
          />
          <Button title={busy === "releases" ? "Exporting…" : "Export CSV"} disabled={busy !== null} onPress={() => void exportCsv("releases")} />
        </Card>
        <Card style={{ gap: space.sm }}>
          <Text style={[type.body, { fontWeight: "800" }]}>Song of the Day / Week and Album of the Week history</Text>
          <Text style={type.small}>Every winner with the totals that won it.</Text>
          <Button title={busy === "awards" ? "Exporting…" : "Export CSV"} kind="secondary" disabled={busy !== null} onPress={() => void exportCsv("awards")} />
        </Card>
        {error ? <ErrorBanner message={error} /> : null}
        <Text style={type.small}>Share these only under an agreement with the partner, and keep the files private.</Text>
      </ScrollView>
    </>
  );
}
