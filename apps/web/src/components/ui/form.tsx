import type { ComponentProps, ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  ...input
}: ComponentProps<"input"> & { label: string; hint?: ReactNode; error?: string | undefined }) {
  const id = input.id ?? input.name;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="mt-1.5 block w-full rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none aria-invalid:border-red-400"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-300">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...input
}: ComponentProps<"textarea"> & { label: string; hint?: ReactNode; error?: string | undefined }) {
  const id = input.id ?? input.name;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        {...input}
        aria-invalid={error ? true : undefined}
        className="mt-1.5 block w-full resize-none rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm placeholder:text-muted/70 focus:border-violet focus:outline-none aria-invalid:border-red-400"
      />
      {error ? <p className="mt-1.5 text-xs text-red-300">{error}</p> : hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: "primary" | "ghost" }) {
  const styles =
    variant === "primary"
      ? "bg-violet text-white hover:bg-violet/85"
      : "border border-line text-text hover:border-violet";
  return (
    <button
      {...props}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${styles} ${className}`}
    />
  );
}

export function FormMessage({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${
        tone === "error" ? "border-red-400/40 bg-red-400/10 text-red-200" : "border-violet/40 bg-violet/10 text-violet-soft"
      }`}
    >
      {children}
    </p>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm pt-10 sm:pt-16">
      <h1 className="font-display text-3xl font-bold uppercase">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted">
      <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
    </div>
  );
}
