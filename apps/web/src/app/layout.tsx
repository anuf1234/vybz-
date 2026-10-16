import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
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
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-line/60 bg-ink/85 backdrop-blur">
          <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
            <Link href="/" className="font-display text-xl font-bold tracking-[0.2em]">
              VYBZ
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/search" className="text-sm text-muted transition-colors hover:text-text">
                Search
              </Link>
              {actor ? (
                <>
                  <Link
                    href={actor.handle ? `/u/${actor.handle}` : "/onboarding"}
                    className="max-w-28 truncate text-sm font-medium text-violet-soft hover:text-text"
                  >
                    {actor.handle ? `@${actor.handle}` : "Finish setup"}
                  </Link>
                  <SignOutButton />
                </>
              ) : (
                <Link
                  href="/sign-in"
                  className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-violet"
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-24">{children}</main>
      </body>
    </html>
  );
}
