"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  discover: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 6.5-2 5-5 2 2-5 5-2Z",
  battle: "M4 4h6v6H4zM14 14h6v6h-6zM14 4l6 6M4 20l6-6",
  my: "M5 4h14v16l-7-4-7 4z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function active(path: string, href: string) {
  if (href === "/battle") return path === "/battle" || (path.startsWith("/battle/") && !path.startsWith("/battle/create"));
  return path === href || path.startsWith(`${href}/`);
}

/** Desktop links in the header. */
export function HeaderLinks({ myHref }: { myHref: string }) {
  const path = usePathname();
  const links = [
    { href: "/discover", label: "Discover" },
    { href: "/battle", label: "Battles" },
    { href: myHref, label: "My battles" },
  ];
  return (
    <div className="hidden items-center gap-5 md:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(path, l.href) ? "page" : undefined}
          className="text-sm text-muted transition-colors hover:text-text aria-[current=page]:text-text"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/** Mobile tab bar with the persistent + BATTLE button in the middle. */
export function TabBar({ profileHref, myHref }: { profileHref: string; myHref: string }) {
  const path = usePathname();
  const tab = (href: string, label: string, d: string) => (
    <Link
      href={href}
      aria-current={active(path, href) ? "page" : undefined}
      className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted aria-[current=page]:text-text"
    >
      <Icon d={d} />
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-end">
        {tab("/discover", "Discover", ICONS.discover)}
        {tab("/battle", "Battles", ICONS.battle)}
        <Link
          href="/battle/create"
          className="-mt-5 mx-1 flex flex-col items-center gap-0.5 rounded-2xl bg-violet px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_0_24px_-4px] shadow-violet/70"
        >
          <span className="text-xl leading-none" aria-hidden>
            +
          </span>
          Battle
        </Link>
        {tab(myHref, "Mine", ICONS.my)}
        {tab(profileHref, "Profile", ICONS.profile)}
      </div>
    </nav>
  );
}
