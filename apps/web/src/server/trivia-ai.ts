import { type TriviaCategory, type TriviaQuestionInput, genreLabel } from "@vybz/core";
import type { TriviaDrafter } from "./trivia";

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answerIndex: { type: "integer" },
          difficulty: { type: "integer", description: "1 easy, 2 medium, 3 hard" },
          explanation: { type: "string", description: "One sentence on why the answer is right" },
        },
        required: ["prompt", "choices", "answerIndex", "difficulty", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const SYSTEM = `You write multiple-choice music trivia for VYBZ, a music battle app. Staff review every question before players see it.

Rules:
- Only well-documented facts you are confident about (origins, members, instruments, labels, formats, eras, tempos, awards). If unsure, leave it out.
- Exactly 4 choices, one clearly correct, three plausible wrong answers of the same kind.
- Never quote, paraphrase or ask players to complete song lyrics. Song and album titles are fine.
- No questions about private lives, deaths, crimes, health or controversies.
- Prompts under 140 characters, choices under 40.`;

const CATEGORY_HINT: Record<string, string> = {
  GENRE: "about the genre itself: its sounds, typical tempo, instruments, scenes, roots and sub-styles",
  ARTIST: "about artists and groups: where they're from, instruments, groups and labels, notable albums",
  HISTORY: "about music history: labels, studios, formats, technology, festivals, charts and firsts",
};

/** Claude drafts questions as JSON; they land in the review queue as drafts. */
export class AnthropicTriviaDrafter implements TriviaDrafter {
  constructor(private readonly cfg: { apiKey: string; model: string; fetch?: typeof fetch }) {}

  async draft(input: { category: TriviaCategory; genre: string | null; count: number; avoid: string[] }): Promise<TriviaQuestionInput[]> {
    const ask = [
      `Write ${input.count} questions ${CATEGORY_HINT[input.category] ?? ""}${input.genre ? `, all about ${genreLabel(input.genre)}` : ", across genres"}.`,
      input.avoid.length ? `Don't repeat these existing questions:\n${input.avoid.slice(0, 60).map((a) => `- ${a}`).join("\n")}` : "",
    ].join("\n\n");
    const res = await (this.cfg.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: ask }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    if (!res.ok) throw new Error(`trivia draft request failed: ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("no draft returned");
    const parsed = JSON.parse(text) as { questions: (TriviaQuestionInput & { difficulty: number })[] };
    return parsed.questions.slice(0, input.count).map((q) => ({ ...q, category: input.category, genre: input.genre }));
  }
}
