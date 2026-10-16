import type { ReactNode } from "react";
import { LinkButton } from "./button";

/** Shown when a list or section has nothing in it yet. Always offers a next step when there is one. */
export function EmptyState({
  title,
  body,
  action,
  icon = "🎧",
}: {
  title: string;
  body?: ReactNode;
  action?: { href: string; label: string };
  icon?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <p className="text-3xl" aria-hidden>
        {icon}
      </p>
      <p className="mt-2 font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && (
        <LinkButton href={action.href} size="sm" className="mt-4">
          {action.label}
        </LinkButton>
      )}
    </div>
  );
}

/** Full-page status: 403, 404, 500 and friends. */
export function StatusPage({
  code,
  title,
  body,
  actions,
}: {
  code: string;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md pt-16 text-center sm:pt-24">
      <p className="font-display text-7xl font-bold text-violet/60">{code}</p>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase">{title}</h1>
      <div className="mt-3 text-sm text-muted">{body}</div>
      {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

export function Forbidden({ body }: { body?: ReactNode }) {
  return (
    <StatusPage
      code="403"
      title="Not for you"
      body={body ?? "You don't have access to this page."}
      actions={<LinkButton href="/">Go home</LinkButton>}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-surface-2 ${className}`} />;
}

export function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}
