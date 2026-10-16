import type { ComponentProps } from "react";

export function Select({
  label,
  hint,
  error,
  children,
  ...props
}: ComponentProps<"select"> & { label: string; hint?: string; error?: string | undefined }) {
  const id = props.id ?? props.name;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        className="mt-1.5 block w-full rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm focus:border-violet focus:outline-none"
      >
        {children}
      </select>
      {error ? <p className="mt-1.5 text-xs text-red-300">{error}</p> : hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** A row of large radio "cards", e.g. round counts or modes. */
export function ChoiceGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  columns = 3,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3 | 4;
}) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns];
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className={`mt-1.5 grid gap-2 ${cols}`}>
        {options.map((o) => (
          <label key={String(o.value)} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={String(o.value)}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="block h-full rounded-xl border border-line bg-surface-1 px-3 py-3 peer-checked:border-violet peer-checked:bg-plum peer-focus-visible:ring-2 peer-focus-visible:ring-violet">
              <span className="block text-sm font-semibold">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
