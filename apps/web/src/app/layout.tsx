import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ServiceWorker } from "@/components/service-worker";
import { serverEnv } from "@/server/env";
import "./globals.css";

/** Link previews need absolute image URLs, so they use this deployment's own address. */
export function generateMetadata(): Metadata {
  let base = "https://urexp.com";
  try {
    base = serverEnv().BETTER_AUTH_URL ?? base;
  } catch {
    // Build without env: keep the production domain.
  }
  return {
    title: { default: "VYBZ", template: "%s · VYBZ" },
    description: "Battle your music taste. The crowd decides.",
    metadataBase: new URL(base),
    applicationName: "VYBZ",
    appleWebApp: { capable: true, title: "VYBZ", statusBarStyle: "black-translucent" },
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0614",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ServiceWorker />
        <header className="sticky top-0 z-10 border-b border-line/60 bg-ink/85 backdrop-blur">
          <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" className="font-display text-xl font-bold tracking-[0.2em]">
              VYBZ
            </Link>
            <Link href="/search" className="text-sm text-muted transition-colors hover:text-text">
              Search music
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-24">{children}</main>
      </body>
    </html>
  );
}
