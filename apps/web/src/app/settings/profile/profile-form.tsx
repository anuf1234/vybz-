"use client";

import { useActionState } from "react";
import { type FormState, updateProfile } from "@/lib/actions/profile";
import { Button, Field, FormMessage, TextArea } from "@/components/ui/form";

export function ProfileForm({ name, bio }: { name: string; bio: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage tone="success">Profile saved.</FormMessage>}
      <Field label="Display name" name="name" defaultValue={name} required maxLength={40} error={state.fieldErrors?.name} />
      <TextArea
        label="Bio"
        name="bio"
        defaultValue={bio}
        maxLength={160}
        placeholder="Your sound in a sentence."
        hint="Up to 160 characters."
        error={state.fieldErrors?.bio}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </Button>
    </form>
  );
}
