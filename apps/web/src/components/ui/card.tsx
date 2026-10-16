import type { ComponentProps, ReactNode } from "react";

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`rounded-2xl border border-line bg-surface-1 p-4 ${className}`} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-6 sm:pt-10">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-soft">{eyebrow}</p>}
      <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none sm:text-5xl">{title}</h1>
      {children && <div className="mt-3 text-sm text-muted">{children}</div>}
    </header>
  );
}
