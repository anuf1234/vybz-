const SIZES = { sm: "size-8 text-sm", md: "size-12 text-lg", lg: "size-20 text-3xl" } as const;

/** Initial on a plum disc. Photo avatars arrive with avatar uploads. */
export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-plum font-display font-bold uppercase text-violet-soft ${SIZES[size]}`}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
