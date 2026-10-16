"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage } from "@/components/ui/form";
import { type FormState, claimUsername } from "@/lib/actions/profile";

export function UsernameForm({ suggestion, displayName, next }: { suggestion: string; displayName: string; next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(claimUsername, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <input type="hidden" name="next" value={next} />
      <Field
        label="Username"
        name="username"
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
        error={state.fieldErrors?.username}
      />
      <Field
        label="Display name"
        name="displayName"
        defaultValue={displayName}
        required
        maxLength={40}
        hint="Shown on your profile and battles. You can change it later."
        error={state.fieldErrors?.displayName}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Let's go"}
      </Button>
    </form>
  );
}
