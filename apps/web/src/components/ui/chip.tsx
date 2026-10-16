import type { ReactNode } from "react";

type Tone = "default" | "live" | "win" | "muted" | "warn";
const TONES: Record<Tone, string> = {
  default: "bg-surface-3 text-violet-soft",
  live: "bg-live/10 text-live",
  win: "bg-win/10 text-win",
  muted: "bg-surface-2 text-muted",
  warn: "bg-amber-400/10 text-amber-200",
};

export function Chip({ tone = "default", children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${TONES[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
