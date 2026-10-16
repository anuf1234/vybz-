import { prisma } from "@vybz/db";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { HeaderLinks, TabBar } from "@/components/nav/nav-links";
import { SignOutButton } from "@/components/sign-out-button";
import { LinkButton } from "@/components/ui/button";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { getActor } from "@/lib/auth/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VYBZ", template: "%s · VYBZ" },
  description: "Battle your music taste. The crowd decides.",
  metadataBase: new URL("https://urexp.com"),
};

export const viewport: Viewport = {
  themeColor: "#0b0614",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const unread = actor
    ? await prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }).catch(() => 0)
    : 0;
  const profileHref = actor ? (actor.handle ? `/profile/${actor.handle}` : "/onboarding") : "/login";
  const myHref = actor ? "/battles/my" : "/login?next=/battles/my";

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-violet focus:px-4 focus:py-2">
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-line/60 bg-ink/85 backdrop-blur">
          <nav aria-label="Top" className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
            <div className="flex items-center gap-8">
              <Link href="/" className="font-display text-xl font-bold tracking-[0.2em]">
                VYBZ
              </Link>
              <HeaderLinks myHref={myHref} />
            </div>
            <div className="flex items-center gap-3">
              <LinkButton href="/battle/create" size="sm" className="hidden md:inline-flex">
                + Battle
              </LinkButton>
              {actor ? (
                <>
                  <Link
                    href="/notifications"
                    aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
                    className="relative grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                      <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0" />
                    </svg>
                    {unread > 0 && (
                      <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-live px-1 text-[10px] font-bold text-ink">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </Link>
                  <Link
                    href={profileHref}
                    className="hidden max-w-32 truncate text-sm font-medium text-violet-soft hover:text-text md:block"
                  >
                    {actor.handle ? `@${actor.handle}` : "Finish setup"}
                  </Link>
                  <Link href="/settings" className="hidden text-sm text-muted hover:text-text md:block">
                    Settings
                  </Link>
                  <span className="hidden md:block">
                    <SignOutButton />
                  </span>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-sm font-semibold text-muted hover:text-text">
                    Log in
                  </Link>
                  <LinkButton href="/signup" size="sm" variant="ghost">
                    Sign up
                  </LinkButton>
                </>
              )}
            </div>
          </nav>
        </header>
        <OfflineBanner />
        <main id="main" className="mx-auto max-w-5xl px-4 pb-32 md:pb-24">
          {children}
        </main>
        <TabBar profileHref={profileHref} myHref={myHref} />
      </body>
    </html>
  );
}
