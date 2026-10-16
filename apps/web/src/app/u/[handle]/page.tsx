import { HandleSchema, can } from "@vybz/core";
import { prisma } from "@vybz/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getActor } from "@/lib/auth/server";

type Params = { params: Promise<{ handle: string }> };

const loadProfile = cache(async (raw: string) => {
  const parsed = HandleSchema.safeParse(decodeURIComponent(raw));
  if (!parsed.success) return null;
  return prisma.user.findUnique({
    where: { handle: parsed.data },
    select: { id: true, name: true, handle: true, bio: true, role: true, status: true, createdAt: true },
  });
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await loadProfile((await params).handle);
  if (!user || user.status === "BANNED") return { title: "Not found" };
  return { title: `${user.name} (@${user.handle})`, description: user.bio ?? undefined };
}

export default async function ProfilePage({ params }: Params) {
  const [user, actor] = await Promise.all([loadProfile((await params).handle), getActor()]);
  if (!user || !can(actor, { type: "profile.view", target: user }).allow) notFound();

  const isOwner = actor?.id === user.id;
  const joined = user.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="pt-10">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="grid size-20 shrink-0 place-items-center rounded-full bg-plum font-display text-3xl font-bold uppercase text-violet-soft"
        >
          {user.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl font-bold">{user.name}</h1>
          <p className="text-sm text-muted">
            @{user.handle}
            {user.role !== "USER" && (
              <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] uppercase tracking-widest text-violet-soft">
                {user.role === "CREATOR" ? "DJ / Creator" : user.role.toLowerCase()}
              </span>
            )}
          </p>
          {/* Plain text only: React escapes it, and whitespace-pre-line keeps line breaks. */}
          {user.bio && <p className="mt-3 whitespace-pre-line text-sm">{user.bio}</p>}
          <p className="mt-3 text-xs text-muted">Joined {joined}</p>
        </div>
      </div>

      {isOwner && (
        <Link
          href="/settings/profile"
          className="mt-6 inline-block rounded-full border border-line px-4 py-2 text-xs font-semibold hover:border-violet"
        >
          Edit profile
        </Link>
      )}

      <section aria-label="Battle record" className="mt-10 grid grid-cols-3 gap-2">
        {[
          ["Wins", "0"],
          ["Losses", "0"],
          ["Battles", "0"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-1 p-4">
            <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
            <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
