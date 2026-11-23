import { AI_RUBRIC, RUBRIC_KEYS, type RubricKey, compactCount, genreLabel } from "@vybz/core";
import { z } from "zod";

/**
 * The AI judge. It never hears the audio (VYBZ doesn't download or proxy
 * provider audio), so it judges from what it knows about each song against
 * the rubric (AI_RUBRIC: theme fit, quality, impact on release, awards,
 * legacy and replay value, streaming today, crowd appeal), plus live YouTube
 * view counts we look up. It sees the sides only as "A" and "B" in a
 * per-round random order, never who picked them.
 */

export interface JudgeTrack {
  title: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  genres: string[];
  durationMs: number | null;
  /** Live YouTube views of the upload VYBZ plays, looked up at judging time. Null when unknown. */
  youtubeViews?: number | null;
  /** Out this year or last: possibly newer than the AI's knowledge. */
  recent?: boolean;
}

export interface JudgeInput {
  battleTitle: string;
  theme: string | null;
  genres: string[];
  eraFrom?: number | undefined;
  eraTo?: number | undefined;
  roundNumber: number;
  suddenDeath: boolean;
  sides: { label: "A" | "B"; tracks: JudgeTrack[] }[];
}

export interface JudgeVerdict {
  winner: "A" | "B";
  /** 0..1 */
  confidence: number;
  /** One or two sentences shown to everyone after the round. */
  reason: string;
  model: string;
  /** Who had the edge on each rubric criterion, with a few words why. */
  breakdown?: { criterion: RubricKey; edge: "A" | "B" | "EVEN"; note: string }[];
}

export interface AiJudge {
  /** Shown in the app, e.g. "Claude". */
  readonly label: string;
  judge(input: JudgeInput): Promise<JudgeVerdict>;
}

export class AiJudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiJudgeError";
  }
}

const VerdictSchema = z.object({
  winner: z.enum(["A", "B"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(400),
  breakdown: z.array(z.object({ criterion: z.enum(RUBRIC_KEYS), edge: z.enum(["A", "B", "EVEN"]), note: z.string().max(200) })).max(AI_RUBRIC.length).default([]),
});

const VERDICT_JSON_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["A", "B"] },
    confidence: { type: "number", description: "0 to 1: how clear-cut the decision is" },
    reason: { type: "string", description: "One or two sentences, under 280 characters, naming the deciding factors" },
    breakdown: {
      type: "array",
      description: "One entry per criterion, in rubric order",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", enum: [...RUBRIC_KEYS] },
          edge: { type: "string", enum: ["A", "B", "EVEN"] },
          note: { type: "string", description: "Under 100 characters: why that side had the edge" },
        },
        required: ["criterion", "edge", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["winner", "confidence", "reason", "breakdown"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the AI judge in VYBZ, a music battle game. Two sides each picked songs for a round; you decide which side's pick is stronger for this battle.

Judge on these criteria, most important first:
${AI_RUBRIC.map((r, i) => `${i + 1}. ${r.label} (${r.key}): ${r.hint}`).join("\n")}

Rules:
- You cannot hear the audio. Judge from your knowledge of these specific recordings.
- Facts: name awards, chart peaks, remakes or samples only when you're confident of them. Never invent them. Leave out what you're unsure of.
- Streaming today: use only the live YouTube view counts given below (they're of the upload VYBZ plays, so treat them as a rough signal, not a precise ranking). Never state other streaming numbers from memory. If no count is given, judge "today" on how present the song still is, without numbers.
- New releases (marked "recent") or songs you don't know may be newer than your knowledge. Judge them on theme fit, the facts given and the live views. Don't count being unknown against them, and mark criteria you can't assess as EVEN.
- Sides are labelled A and B in random order. You don't know who picked them; don't speculate.
- Be decisive. Pick exactly one winner even when it's close, and reflect closeness in confidence. Fit outweighs everything else: an off-theme pick shouldn't win on reputation.
- Give the breakdown: one entry per criterion, in order, with the side that had the edge (or EVEN) and a few words why.
- Keep the reason short, specific and friendly. No markdown.`;

function describe(input: JudgeInput): string {
  const rules: string[] = [];
  if (input.genres.length) rules.push(`Genre: ${input.genres.map(genreLabel).join(" or ")}`);
  if (input.eraFrom !== undefined || input.eraTo !== undefined) rules.push(`Era: ${input.eraFrom ?? "any"}–${input.eraTo ?? "now"}`);
  const sides = input.sides
    .map(
      (s) =>
        `Side ${s.label}:\n` +
        s.tracks
          .map((t, i) => {
            const bits = [
              t.artistName,
              t.albumName ? `album "${t.albumName}"` : null,
              t.releaseYear ? String(t.releaseYear) : null,
              t.genres.length ? t.genres.join(", ") : null,
              t.recent ? "recent" : null,
              typeof t.youtubeViews === "number" ? `${compactCount(t.youtubeViews)} YouTube views today` : null,
            ];
            return `  ${i + 1}. "${t.title}" (${bits.filter(Boolean).join(" · ")})`;
          })
          .join("\n"),
    )
    .join("\n\n");
  return [
    `Battle: ${input.battleTitle}`,
    input.theme ? `Theme: ${input.theme}` : null,
    rules.length ? rules.join("\n") : null,
    `Round ${input.roundNumber}${input.suddenDeath ? " (sudden death)" : ""}`,
    "",
    sides,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export interface AnthropicJudgeConfig {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Claude via the Messages API, with the verdict constrained to a JSON schema. */
export class AnthropicJudge implements AiJudge {
  readonly label = "Claude";
  constructor(private readonly cfg: AnthropicJudgeConfig) {}

  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    const res = await (this.cfg.fetch ?? fetch)(`${this.cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: describe(input) }],
        output_config: { format: { type: "json_schema", schema: VERDICT_JSON_SCHEMA } },
      }),
    });
    if (!res.ok) throw new AiJudgeError(`AI judge request failed: ${res.status}`);
    const body = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (body.stop_reason === "refusal") throw new AiJudgeError("AI judge declined to rule");
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new AiJudgeError("AI judge returned no verdict");
    let parsed: z.infer<typeof VerdictSchema>;
    try {
      parsed = VerdictSchema.parse(JSON.parse(text));
    } catch {
      throw new AiJudgeError("AI judge returned an invalid verdict");
    }
    // One entry per criterion, in rubric order (extras or repeats dropped).
    const breakdown = AI_RUBRIC.map((r) => parsed.breakdown.find((b) => b.criterion === r.key)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => ({ ...b, note: b.note.slice(0, 120) }));
    return { winner: parsed.winner, confidence: parsed.confidence, reason: parsed.reason.slice(0, 280), model: this.cfg.model, breakdown };
  }
}

/**
 * Development stand-in when no API key is set: picks deterministically from
 * the track titles and says so. Only enabled alongside the demo catalog.
 */
export class DemoJudge implements AiJudge {
  readonly label = "Demo judge";
  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    const key = input.sides.flatMap((s) => s.tracks.map((t) => t.title)).sort().join("|");
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    const winner = (h >>> 0) % 2 === 0 ? "A" : "B";
    return {
      winner,
      confidence: 0.5,
      reason: `Demo judge: side ${winner} picked by a coin flip. Set ANTHROPIC_API_KEY for real AI judging.`,
      model: "demo",
      breakdown: AI_RUBRIC.map((r) => ({ criterion: r.key, edge: r.key === "fit" ? winner : ("EVEN" as const), note: r.key === "fit" ? "Coin flip (demo judge)" : "Not judged by the demo judge" })),
    };
  }
}

export { describe as describeForJudge };
