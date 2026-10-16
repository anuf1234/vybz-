"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, TextArea } from "@/components/ui/form";
import { type FormState, updateProfile } from "@/lib/actions/profile";

export function ProfileForm(props: { username: string; displayName: string; bio: string; favoriteGenres: string[]; genres: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage tone="success">Profile saved.</FormMessage>}
      <p className="text-sm text-muted">
        Username <span className="font-semibold text-text">@{props.username}</span> (permanent)
      </p>
      <Field label="Display name" name="displayName" defaultValue={props.displayName} required maxLength={40} error={state.fieldErrors?.name} />
      <TextArea
        label="Bio"
        name="bio"
        defaultValue={props.bio}
        maxLength={160}
        placeholder="Your sound in a sentence."
        hint="Up to 160 characters."
        error={state.fieldErrors?.bio}
      />
      <fieldset>
        <legend className="text-sm font-medium">Favorite genres</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {props.genres.map((g) => (
            <label key={g} className="cursor-pointer">
              <input type="checkbox" name="favoriteGenres" value={g} defaultChecked={props.favoriteGenres.includes(g)} className="peer sr-only" />
              <span className="block rounded-full border border-line px-3 py-1.5 text-xs peer-checked:border-violet peer-checked:bg-plum peer-focus-visible:ring-2 peer-focus-visible:ring-violet">
                {g}
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.favoriteGenres && <p className="mt-1.5 text-xs text-red-300">{state.fieldErrors.favoriteGenres}</p>}
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save profile"}
      </Button>
    </form>
  );
}
