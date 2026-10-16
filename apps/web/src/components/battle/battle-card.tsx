import { BATTLE_TYPE_LABELS, type BattleType } from "@vybz/core";
import Link from "next/link";
import { Chip } from "@/components/ui/chip";

export interface BattleCardData {
  id: string;
  title: string;
  theme: string;
  type: BattleType;
  status: string;
  roundCount: number;
  tagline?: string | null;
  left: string;
  right: string | null;
  line: string;
  live?: boolean;
  score?: [number, number] | null;
  winnerSide?: number | null;
}

/** One battle in a list. The whole card is the link. */
export function BattleCard({ b }: { b: BattleCardData }) {
  return (
    <li>
      <Link href={`/battle/${b.id}`} className="block rounded-2xl border border-line bg-surface-1 p-4 transition-colors hover:border-violet">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{b.title}</p>
            <p className="mt-0.5 truncate text-sm text-muted">
              @{b.left} <span className="text-xs">vs</span> {b.right ? `@${b.right}` : "anyone"}
            </p>
          </div>
          {b.live ? (
            <Chip tone="live" dot>
              Live
            </Chip>
          ) : b.score ? (
            <span className="font-display text-2xl font-bold tabular-nums">
              <span className={b.winnerSide === 0 ? "text-win" : ""}>{b.score[0]}</span>
              <span className="text-muted">–</span>
              <span className={b.winnerSide === 1 ? "text-win" : ""}>{b.score[1]}</span>
            </span>
          ) : null}
        </div>
        {b.tagline && <p className="mt-2 text-sm italic text-violet-soft">“{b.tagline}”</p>}
        <p className="mt-2 text-xs text-muted">
          {b.line} · {b.type === "SONG_FOR_SONG" ? `${b.roundCount} rounds` : BATTLE_TYPE_LABELS[b.type]} · {b.theme}
        </p>
      </Link>
    </li>
  );
}
