import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/lib/auth/server";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Edit profile" };

export default async function ProfileSettingsPage() {
  const actor = await requireActor();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { name: true, bio: true, handle: true, email: true },
  });

  return (
    <div className="mx-auto max-w-sm pt-10">
      <Link href={`/u/${user.handle}`} className="text-xs text-muted hover:text-text">
        ← @{user.handle}
      </Link>
      <h1 className="mt-3 font-display text-3xl font-bold uppercase">Edit profile</h1>
      <p className="mt-2 text-sm text-muted">Signed in as {user.email}</p>
      <div className="mt-8">
        <ProfileForm name={user.name} bio={user.bio ?? ""} />
      </div>
    </div>
  );
}
