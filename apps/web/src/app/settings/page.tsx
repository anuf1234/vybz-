import { GENRES } from "@vybz/core";
import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import { Card, PageHeader, SectionTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { requireActor } from "@/lib/auth/server";
import { configured } from "@/lib/providers";
import { AccountForm } from "./account-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor({ next: "/settings" });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: {
      email: true,
      profile: { select: { username: true, displayName: true, bio: true, favoriteGenres: true } },
      accounts: { select: { providerId: true } },
      musicConnections: { select: { provider: true, status: true } },
    },
  });
  const profile = user.profile!;
  const hasPassword = user.accounts.some((a) => a.providerId === "credential");
  const connection = (p: "APPLE_MUSIC" | "YOUTUBE") => user.musicConnections.find((c) => c.provider === p);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Settings">Signed in as {user.email}</PageHeader>

      <section className="mt-8 space-y-3">
        <SectionTitle>Profile</SectionTitle>
        <Card>
          <ProfileForm
            username={profile.username}
            displayName={profile.displayName}
            bio={profile.bio ?? ""}
            favoriteGenres={profile.favoriteGenres}
            genres={[...GENRES]}
          />
        </Card>
      </section>

      <section className="mt-10 space-y-3">
        <SectionTitle>Music services</SectionTitle>
        <Card className="divide-y divide-line/60 p-0">
          {(
            [
              ["APPLE_MUSIC", "Apple Music", configured.appleMusic ? "Previews work for everyone. Full-song playback for subscribers is coming." : "Not available on this server yet."],
              ["YOUTUBE", "YouTube", configured.youtube ? "Videos play in YouTube's own player." : "Not available on this server yet."],
            ] as const
          ).map(([key, name, note]) => (
            <div key={key} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{name}</p>
                <p className="text-xs text-muted">{note}</p>
              </div>
              <Chip tone={connection(key)?.status === "ACTIVE" ? "live" : "muted"}>{connection(key)?.status === "ACTIVE" ? "Connected" : "Not connected"}</Chip>
            </div>
          ))}
        </Card>
        <p className="text-xs text-muted">You never need to connect anything to battle or vote.</p>
      </section>

      <section className="mt-10 space-y-3">
        <SectionTitle>Account</SectionTitle>
        <Card>
          <AccountForm hasPassword={hasPassword} />
        </Card>
      </section>
    </div>
  );
}
