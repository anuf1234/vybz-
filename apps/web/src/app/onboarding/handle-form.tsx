"use client";

import { useActionState } from "react";
import { type FormState, claimHandle } from "@/lib/actions/profile";
import { Button, Field, FormMessage } from "@/components/ui/form";

export function HandleForm({ suggestion }: { suggestion: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(claimHandle, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <Field
        label="Handle"
        name="handle"
        defaultValue={suggestion}
        placeholder="slowjamsonly"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        minLength={3}
        maxLength={21}
        pattern="@?[A-Za-z0-9_]{3,20}"
        hint="3 to 20 letters, numbers or underscores."
        error={state.fieldErrors?.handle}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Claim handle"}
      </Button>
    </form>
  );
}
