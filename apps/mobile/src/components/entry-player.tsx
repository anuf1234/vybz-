import { Ionicons } from "@expo/vector-icons";
import type { EntryTrackView } from "@vybz/core";
import type { PlaybackSource } from "@vybz/providers";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { TIER_LABEL, seconds } from "@/lib/format";
import { ListenTracker } from "@/lib/listen-tracker";
import { color, radius, space, type } from "./theme";
import { YouTubeEmbed } from "./youtube-embed";

const REPORT_EVERY_MS = 5_000;

export interface EntryPlayerProps {
  entry: EntryTrackView;
  battleId: string;
  roundIndex: number;
  /** Only one entry plays at a time; others pause. */
  active: boolean;
  onActivate: () => void;
  /** Signed in and voting is open: send listen progress to the server. */
  reportListens: boolean;
  /** Called when the server first credits enough listening for this entry. */
  onListenComplete?: () => void;
}

/**
 * Plays one track of a battle entry the way its provider allows and keeps the server's
 * listen proof up to date for the fair-listen vote gate.
 */
export function EntryPlayer({ entry, battleId, roundIndex, active, onActivate, reportListens, onListenComplete }: EntryPlayerProps) {
  const source = entry.playback;
  const required = entry.listen.requiredMs;
  const tracker = useRef(new ListenTracker(entry.listen.playedMs));
  const [played, setPlayed] = useState(entry.listen.playedMs);
  const [credited, setCredited] = useState(entry.listen.playedMs);
  const lastReport = useRef(0);
  const completed = useRef(entry.listen.playedMs >= required);

  const report = useCallback(async () => {
    if (!reportListens || !source || source.tier === "LINK_OUT") return;
    lastReport.current = Date.now();
    try {
      const res = await api.listen(battleId, roundIndex, { submissionId: entry.submissionId, playedMs: tracker.current.playedMs(Date.now()), tier: source.tier });
      tracker.current.sync(res.playedMs);
      setCredited(res.playedMs);
      if (!completed.current && res.playedMs >= res.requiredMs) {
        completed.current = true;
        onListenComplete?.();
      }
    } catch {
      // Progress is retried on the next tick; nothing to show the listener.
    }
  }, [reportListens, source, battleId, roundIndex, entry.submissionId, onListenComplete]);

  const onPlayingChange = useCallback(
    (playing: boolean) => {
      const now = Date.now();
      if (playing === tracker.current.isPlaying) return;
      if (playing) {
        onActivate();
        tracker.current.play(now);
      } else {
        tracker.current.pause(now);
      }
      setPlayed(tracker.current.playedMs(now));
      void report();
    },
    [onActivate, report],
  );

  // Tick the meter while playing and report periodically.
  useEffect(() => {
    const t = setInterval(() => {
      if (!tracker.current.isPlaying) return;
      const now = Date.now();
      setPlayed(tracker.current.playedMs(now));
      if (now - lastReport.current >= REPORT_EVERY_MS) void report();
    }, 500);
    return () => clearInterval(t);
  }, [report]);

  const shown = Math.min(Math.max(played, credited), required || 1);
  const pct = required > 0 ? Math.min(1, shown / required) : 1;
  const done = credited >= required;

  return (
    <View style={{ gap: space.sm }}>
      {source ? <SourceView source={source} active={active} onPlayingChange={onPlayingChange} title={entry.track.title} /> : <Text style={type.small}>Not playable here.</Text>}
      {reportListens && source && source.tier !== "LINK_OUT" ? (
        <View style={{ gap: 4 }} accessibilityLabel={done ? "Listened enough to vote" : `Listened ${seconds(shown)} of ${seconds(required)}`}>
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${pct * 100}%` }, done && { backgroundColor: color.violetSoft }]} />
          </View>
          <Text style={type.small}>{done ? "Listened ✓" : `Listen ${seconds(Math.max(0, required - shown))} more to unlock voting`}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SourceView({ source, active, onPlayingChange, title }: { source: PlaybackSource; active: boolean; onPlayingChange: (p: boolean) => void; title: string }) {
  if (source.tier === "EMBED") {
    return (
      <View style={{ gap: 6 }}>
        <YouTubeEmbed videoId={source.embed.videoId} active={active} onPlayingChange={onPlayingChange} />
        <Attribution source={source} />
      </View>
    );
  }
  if (source.tier === "HOSTED_FULL" || source.tier === "PREVIEW") {
    return <AudioSourcePlayer url={source.url} maxMs={source.restrictions.maxPlayMs} active={active} onPlayingChange={onPlayingChange} title={title} source={source} />;
  }
  if (source.tier === "LINK_OUT") {
    return (
      <Pressable onPress={() => void Linking.openURL(source.href)} accessibilityRole="link" style={styles.linkOut}>
        <Text style={{ color: color.violetSoft, fontWeight: "700" }}>Open in {source.attribution.label} ↗</Text>
      </Pressable>
    );
  }
  // PROVIDER_FULL (MusicKit) needs a native module; not offered on mobile yet.
  return <Text style={type.small}>Available in the browser with Apple Music.</Text>;
}

function AudioSourcePlayer({
  url,
  maxMs,
  active,
  onPlayingChange,
  title,
  source,
}: {
  url: string;
  maxMs: number | undefined;
  active: boolean;
  onPlayingChange: (p: boolean) => void;
  title: string;
  source: PlaybackSource;
}) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const limitS = maxMs ? maxMs / 1000 : null;
  const duration = limitS && status.duration ? Math.min(status.duration, limitS) : status.duration || limitS || 0;

  useEffect(() => {
    onPlayingChange(status.playing);
  }, [status.playing, onPlayingChange]);

  // Pause only when another entry takes over, not when this one is starting up
  // (its own play event is what makes it active).
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && player.playing) player.pause();
    wasActive.current = active;
  }, [active, player]);

  // Previews stop at the provider's limit.
  useEffect(() => {
    if (limitS && status.currentTime >= limitS && status.playing) player.pause();
  }, [limitS, status.currentTime, status.playing, player]);

  const toggle = () => {
    if (status.playing) return player.pause();
    if (duration && status.currentTime >= duration - 0.25) void player.seekTo(0);
    player.play();
  };

  const pct = duration ? Math.min(1, status.currentTime / duration) : 0;

  return (
    <View style={styles.audio}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? `Pause ${title}` : `Play ${title}`}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={22} color="#fff" />
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={type.small}>
            {fmt(status.currentTime)} / {fmt(duration)}
          </Text>
          <Text style={type.small}>{TIER_LABEL[source.tier]}</Text>
        </View>
        <Attribution source={source} />
      </View>
    </View>
  );
}

function Attribution({ source }: { source: PlaybackSource }) {
  const { label, href } = source.attribution;
  const prefix = source.tier === "PREVIEW" ? "Preview from" : source.tier === "EMBED" ? "Playing on" : "From";
  if (!href) return <Text style={[type.small, { fontSize: 11 }]}>{`${prefix} ${label}`}</Text>;
  return (
    <Pressable onPress={() => void Linking.openURL(href)} accessibilityRole="link">
      <Text style={[type.small, { fontSize: 11, color: color.violetSoft }]}>{`${prefix} ${label} ↗`}</Text>
    </Pressable>
  );
}

function fmt(s: number): string {
  const v = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  audio: { flexDirection: "row", gap: space.md, alignItems: "center" },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.violet, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: color.surface3, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: color.text },
  meterTrack: { height: 6, borderRadius: 3, backgroundColor: color.surface3, overflow: "hidden" },
  meterFill: { height: 6, backgroundColor: color.violet },
  linkOut: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, alignItems: "center" },
});
