import type { ReactNode } from "react";

export const OPERATOR = "ACE IT Solutions Corp";
export const UPDATED = "November 17, 2026";

/** Shared layout for the privacy, terms and data-deletion pages. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl py-12 leading-relaxed">
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
      <div className="mt-8 space-y-6 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-violet-soft [&_a]:underline">{children}</div>
    </article>
  );
}
