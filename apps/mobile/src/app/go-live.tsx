import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { color, space, type } from "@/components/theme";
import { Button, Card } from "@/components/ui";
import { API_URL } from "@/lib/config";

/**
 * Go live: put a battle (or a party) on a stream or a TV. Vertical for
 * TikTok and Instagram Live, landscape for TVs, YouTube and Twitch. Anyone
 * can stream the same battle at once. Music plays on the big screen only if
 * the person running it turns it on with their own YouTube or Apple Music.
 */
export default function GoLive() {
  const { battleId, code, party } = useLocalSearchParams<{ battleId?: string; code?: string; party?: string }>();
  const [copied, setCopied] = useState<string | null>(null);
  const isParty = party === "1" || !battleId;
  const q = code ? `code=${encodeURIComponent(code)}` : "";
  const vertical = battleId ? `${API_URL}/watch/${battleId}?layout=vertical${q ? `&${q}` : ""}` : null;
  const wide = battleId ? `${API_URL}/watch/${battleId}${q ? `?${q}` : ""}` : `${API_URL}/party`;

  const copy = async (url: string, what: string) => {
    await Clipboard.setStringAsync(url);
    setCopied(what);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: isParty ? "Stream your party" : "Go live" }} />
      <Text style={type.small}>
        {isParty
          ? "The party's host screen is a web page: cast it to a TV, share it on a stream, or add it to OBS."
          : "Anyone can stream this battle at the same time: each stream shows the same live score, picks and a QR code viewers scan to vote."}
      </Text>

      {vertical ? (
        <Card style={{ gap: space.sm }}>
          <Text style={type.heading}>📱 TikTok or Instagram Live (vertical)</Text>
          <Text style={type.small}>A 9:16 view sized for phones.</Text>
          <Button title="Open the vertical view" onPress={() => void WebBrowser.openBrowserAsync(vertical)} />
          <Button title={copied === "vertical" ? "Link copied" : "Copy link for OBS"} kind="secondary" onPress={() => void copy(vertical, "vertical")} />
          <Steps
            items={[
              "TikTok on your phone: Go LIVE, choose screen share (Mobile Gaming), then open the vertical view. TikTok LIVE needs an eligible account (usually 18+ with 1,000 followers).",
              "TikTok on a computer: in TikTok LIVE Studio or OBS, add the copied link as a browser source (1080 × 1920).",
              "Instagram: the app can't share your screen. On a computer, open Instagram Live Producer for a stream key, then stream OBS with the link as a browser source.",
            ]}
          />
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Text style={type.heading}>📺 A TV or another screen</Text>
        <Text style={type.small}>
          {isParty ? "Open the host page on a TV, laptop or projector. Everyone joins from their phone with the code." : "Landscape, with chat and reactions. Also right for YouTube, Twitch and Facebook streams."}
        </Text>
        <Button title={isParty ? "Open the host page" : "Open the TV view"} onPress={() => void WebBrowser.openBrowserAsync(wide)} />
        <Button title={copied === "wide" ? "Link copied" : "Copy link"} kind="secondary" onPress={() => void copy(wide, "wide")} />
        <Steps
          items={[
            "Cast it from this phone (AirPlay or Chromecast), or open the link in the TV's browser or on a laptop plugged into it.",
            "Music on the big screen: tap YouTube, Apple Music or Previews on the screen. Apple Music uses the Apple Music account signed in on that screen; full songs need a subscription.",
          ]}
        />
      </Card>

      <Card style={{ gap: space.sm, borderColor: color.sideB }}>
        <Text style={type.heading}>🎵 Music on a stream</Text>
        <Text style={type.small}>
          Streams that play recorded music can get muted or taken down, even when you're allowed to listen. To stay safe, leave the screen's music off while live: viewers hear every pick in VYBZ when they scan to vote.
          {isParty ? " For parties, turn on Stream-safe mode on the host screen: the TV stays silent and Name That Song plays on each phone." : ""}
        </Text>
      </Card>
    </ScrollView>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((t, i) => (
        <Text key={i} style={type.small}>
          {i + 1}. {t}
        </Text>
      ))}
    </View>
  );
}
