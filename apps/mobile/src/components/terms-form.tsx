import {
  type BattleRules,
  type BattleRulesInput,
  DECADES,
  DURATION_PRESETS,
  ROUND_TIMING,
  GENRES,
  type JudgingMode,
  MAX_ENTRANTS,
  ROUND_COUNTS,
  type RoundCount,
  TRACKS_PER_ROUND,
  type TracksPerRound,
  battleLengthMinutes,
  decadeLabel,
  themeLabel,
  windowsForDuration,
} from "@vybz/core";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { JUDGING_HELP, JUDGING_LABEL } from "@/lib/format";
import { useServerConfig } from "@/lib/config";
import { color, radius, space, type } from "./theme";
import { SectionTitle, Segmented } from "./ui";

/**
 * Battle terms both players agree on: genre and era, rounds, tracks per round,
 * judging, pace and voting rules. Used to create a battle and to counter one.
 */
export type DurationKey = (typeof DURATION_PRESETS)[number]["key"];

export interface Terms {
  format: "DUEL" | "MULTI";
  /** Group battles: most players allowed. */
  maxEntrants: number;
  /** Up to 3 genre keys; empty = any genre. */
  genres: string[];
  /** Start year of a decade, or null for any era. */
  decade: number | null;
  rounds: RoundCount;
  tracksPerRound: TracksPerRound;
  judging: JudgingMode;
  aiWeight: number;
  duration: DurationKey;
  blind: boolean;
  liveTallies: boolean;
}

const AI_WEIGHTS = [25, 40, 50, 75] as const;

export const DEFAULT_TERMS: Terms = {
  format: "DUEL",
  maxEntrants: 4,
  genres: ["rnb"],
  decade: 1990,
  rounds: 5,
  tracksPerRound: 1,
  judging: "CROWD",
  aiWeight: 40,
  duration: "24h",
  blind: true,
  liveTallies: false,
};

const MAX_GENRES = 3;

export function termsToRules(t: Terms, base?: BattleRules): BattleRulesInput {
  const constraints = {
    ...(t.genres.length ? { genres: t.genres } : {}),
    ...(t.decade !== null ? { eraFrom: t.decade, eraTo: t.decade + 9 } : {}),
  };
  return {
    // Keep terms this form doesn't edit (listen length, eligibility...) when countering.
    ...(base
      ? { minVotesToCount: base.minVotesToCount, maxVotingExtensions: base.maxVotingExtensions, suddenDeath: base.suddenDeath, fairListen: base.fairListen, voterEligibility: base.voterEligibility, challengeExpiryHours: base.challengeExpiryHours }
      : {}),
    roundCount: t.rounds,
    tracksPerRound: t.tracksPerRound,
    blindVoting: t.blind,
    revealTallies: t.liveTallies ? "LIVE" : "AT_ROUND_CLOSE",
    timing: { submissionWindowMinutes: ROUND_TIMING.pickMaxMinutes, votingWindowMinutes: ROUND_TIMING.voteMinutes },
    entrants: t.format === "DUEL" ? { min: 2, max: 2 } : { min: Math.min(3, t.maxEntrants), max: t.maxEntrants },
    judging: { mode: t.judging, aiWeightPercent: t.aiWeight },
    ...(Object.keys(constraints).length ? { constraints } : {}),
  };
}

export function rulesToTerms(r: BattleRules): Terms {
  const c = r.constraints;
  const decade = c?.eraFrom !== undefined && c.eraFrom % 10 === 0 && c.eraTo === c.eraFrom + 9 ? c.eraFrom : null;
  const length = battleLengthMinutes(r);
  // The closest preset to the battle's actual length.
  const duration = [...DURATION_PRESETS].sort((a, b) => Math.abs(a.minutes - length) - Math.abs(b.minutes - length))[0]!.key;
  return {
    format: r.entrants.max === 2 ? "DUEL" : "MULTI",
    maxEntrants: r.entrants.max === 2 ? 4 : r.entrants.max,
    genres: c?.genres ?? [],
    decade,
    rounds: r.roundCount as RoundCount,
    tracksPerRound: r.tracksPerRound as TracksPerRound,
    judging: r.judging.mode,
    aiWeight: r.judging.aiWeightPercent,
    duration,
    blind: r.blindVoting,
    liveTallies: r.revealTallies === "LIVE",
  };
}

export function termsTheme(t: Terms): string | null {
  return themeLabel({ genres: t.genres.length ? t.genres : undefined, eraFrom: t.decade ?? undefined, eraTo: t.decade !== null ? t.decade + 9 : undefined });
}

/** `counter`: a duel counter-offer, so the format can't change. */
export function TermsForm({ value, onChange, mode = "create" }: { value: Terms; onChange: (t: Terms) => void; mode?: "create" | "counter" }) {
  const config = useServerConfig();
  const aiAvailable = config?.aiJudge.available ?? false;
  const set = <K extends keyof Terms>(k: K, v: Terms[K]) => onChange({ ...value, [k]: v });
  const theme = termsTheme(value);
  const toggleGenre = (key: string) => {
    const has = value.genres.includes(key);
    if (has) return set("genres", value.genres.filter((g) => g !== key));
    if (value.genres.length >= MAX_GENRES) return set("genres", [...value.genres.slice(1), key]);
    set("genres", [...value.genres, key]);
  };

  return (
    <View style={{ gap: space.md }}>
      {mode === "create" ? (
        <>
          <SectionTitle>Format</SectionTitle>
          <Segmented
            value={value.format}
            onChange={(v) => set("format", v)}
            options={[
              { value: "DUEL", label: "Duel · 1 vs 1" },
              { value: "MULTI", label: "Group battle" },
            ]}
          />
          {value.format === "MULTI" ? (
            <View style={{ gap: space.xs }}>
              <Text style={type.label}>Up to how many players</Text>
              <Segmented
                value={String(value.maxEntrants)}
                onChange={(v) => set("maxEntrants", Number(v))}
                options={Array.from({ length: MAX_ENTRANTS - 2 }, (_, i) => i + 3).map((n) => ({ value: String(n), label: String(n) }))}
              />
              <Text style={type.small}>It starts when it's full, or you can start it once 3 have joined.</Text>
            </View>
          ) : null}
        </>
      ) : null}

      <SectionTitle right={theme ? <Text style={[type.small, { color: color.violetSoft, fontWeight: "700" }]}>{theme}</Text> : undefined}>Genres (up to 3)</SectionTitle>
      <View style={styles.chips}>
        <Chip label="Any" active={value.genres.length === 0} onPress={() => set("genres", [])} />
        {GENRES.map((g) => (
          <Chip key={g.key} label={g.label} active={value.genres.includes(g.key)} onPress={() => toggleGenre(g.key)} />
        ))}
      </View>

      <SectionTitle>Era</SectionTitle>
      <View style={styles.chips}>
        <Chip label="Any era" active={value.decade === null} onPress={() => set("decade", null)} />
        {DECADES.map((d) => (
          <Chip key={d} label={decadeLabel(d)} active={value.decade === d} onPress={() => set("decade", d)} />
        ))}
      </View>

      <SectionTitle>Rounds</SectionTitle>
      <Segmented value={String(value.rounds)} onChange={(v) => set("rounds", Number(v) as RoundCount)} options={ROUND_COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />

      <SectionTitle>Tracks per round</SectionTitle>
      <Segmented
        value={String(value.tracksPerRound)}
        onChange={(v) => set("tracksPerRound", Number(v) as TracksPerRound)}
        options={TRACKS_PER_ROUND.map((n) => ({ value: String(n), label: n === 1 ? "1 track" : `${n} tracks` }))}
      />
      <Text style={type.small}>
        {value.rounds * value.tracksPerRound} picks each in total. {value.tracksPerRound > 1 ? "Voters judge each side's set as a whole." : ""}
      </Text>

      <SectionTitle>Who judges</SectionTitle>
      <View style={{ gap: space.sm }}>
        {(["CROWD", "AI", "COMBINED", "SEPARATE"] as const).map((m) => {
          const disabled = m !== "CROWD" && !aiAvailable;
          const active = value.judging === m;
          return (
            <Pressable
              key={m}
              disabled={disabled}
              onPress={() => set("judging", m)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              style={[styles.option, active && styles.optionActive, disabled && { opacity: 0.4 }]}
            >
              <View style={[styles.radio, active && styles.radioOn]} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { fontWeight: "700" }]}>{JUDGING_LABEL[m]}</Text>
                <Text style={type.small}>{JUDGING_HELP[m]}</Text>
              </View>
            </Pressable>
          );
        })}
        {value.judging === "COMBINED" ? (
          <View style={{ gap: space.xs }}>
            <Text style={type.label}>AI share of each round</Text>
            <Segmented value={String(value.aiWeight)} onChange={(v) => set("aiWeight", Number(v))} options={AI_WEIGHTS.map((w) => ({ value: String(w), label: `${w}%` }))} />
          </View>
        ) : null}
        {!aiAvailable && config ? <Text style={type.small}>AI judging isn't set up on this server yet.</Text> : null}
        {value.judging !== "CROWD" && config ? <Text style={type.small}>{config.aiJudge.note}</Text> : null}
      </View>

      <SectionTitle>Pace</SectionTitle>
      <Text style={type.small}>
        Every round: {ROUND_TIMING.pickMaxMinutes} minutes to pick, then {Math.round(ROUND_TIMING.voteMinutes * 60)} seconds to vote. {value.rounds} rounds take about {Math.ceil(value.rounds * (ROUND_TIMING.pickMaxMinutes + ROUND_TIMING.voteMinutes))} minutes at most.
      </Text>

      <SectionTitle>Voting rules</SectionTitle>
      <Row label="Blind voting" hint="Hide who picked what until the round ends">
        <Switch value={value.blind} onValueChange={(v) => set("blind", v)} trackColor={{ true: color.violet, false: color.surface3 }} thumbColor={color.text} />
      </Row>
      <Row label="Live vote counts" hint="Show tallies while voting is open">
        <Switch value={value.liveTallies} onValueChange={(v) => set("liveTallies", v)} trackColor={{ true: color.violet, false: color.surface3 }} thumbColor={color.text} />
      </Row>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? color.text : color.muted, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        {hint ? <Text style={type.small}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  chipActive: { borderColor: color.violet, backgroundColor: color.plum },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
  option: { flexDirection: "row", gap: space.md, alignItems: "center", padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface1 },
  optionActive: { borderColor: color.violet, backgroundColor: color.plum },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: color.muted },
  radioOn: { borderColor: color.violet, backgroundColor: color.violet },
});
