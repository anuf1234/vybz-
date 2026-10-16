"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui/form";
import { type CreateState, createBattle } from "@/lib/actions/battles";

const ROUNDS = [3, 5, 7, 10] as const;
const PACES = [
  { value: "QUICK", label: "Quick", hint: "1 hour to pick, 1 hour to vote" },
  { value: "STANDARD", label: "Standard", hint: "A day to pick, a day to vote" },
  { value: "RELAXED", label: "Relaxed", hint: "Two days each" },
] as const;

export function NewBattleForm({ opponent }: { opponent: string }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createBattle, {});
  return (
    <form action={action} className="space-y-6">
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <Field label="Theme" name="theme" required minLength={3} maxLength={60} placeholder="2000s R&B" />

      <fieldset>
        <legend className="text-sm font-medium">Rounds</legend>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {ROUNDS.map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="roundCount" value={n} defaultChecked={n === 5} className="peer sr-only" />
              <span className="block rounded-xl border border-line bg-surface-1 py-3 text-center font-display text-xl font-bold peer-checked:border-violet peer-checked:bg-plum peer-focus-visible:ring-2 peer-focus-visible:ring-violet">
                {n}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Pace</legend>
        <div className="mt-1.5 space-y-2">
          {PACES.map((p) => (
            <label key={p.value} className="block cursor-pointer">
              <input type="radio" name="pace" value={p.value} defaultChecked={p.value === "STANDARD"} className="peer sr-only" />
              <span className="flex items-baseline justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3 peer-checked:border-violet peer-checked:bg-plum peer-focus-visible:ring-2 peer-focus-visible:ring-violet">
                <span className="text-sm font-semibold">{p.label}</span>
                <span className="text-xs text-muted">{p.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Era (optional)</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <Field label="From year" name="eraFrom" type="number" inputMode="numeric" min={1900} max={2100} placeholder="2000" />
          <Field label="To year" name="eraTo" type="number" inputMode="numeric" min={1900} max={2100} placeholder="2009" />
        </div>
      </fieldset>

      <Field
        label="Opponent (optional)"
        name="opponent"
        defaultValue={opponent}
        maxLength={21}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="@handle"
        hint="Leave empty to post an open challenge anyone can accept."
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating" : "Create battle"}
      </Button>
    </form>
  );
}
