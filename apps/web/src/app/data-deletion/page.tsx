import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { serverEnv } from "@/server/env";

/** Read SUPPORT_EMAIL when the page is served, not at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Delete your data" };

export default function DataDeletion() {
  const email = serverEnv().SUPPORT_EMAIL;
  return (
    <LegalPage title="Delete your VYBZ data">
      <h2>In the app</h2>
      <p>Open VYBZ, go to Profile → Delete account, and confirm. It takes effect right away.</p>

      <h2>By email</h2>
      <p>
        If you can&apos;t open the app, email <a href={`mailto:${email}`}>{email}</a> from the address on your account (or tell us your handle) and ask us to delete it. We&apos;ll confirm within 30 days.
      </p>

      <h2>What gets deleted</h2>
      <ul>
        <li>Your sign-in methods (email and password, and any Google, Facebook, TikTok or Apple link) and all sessions.</li>
        <li>Your posts, comments, chat messages, direct-message conversations, likes, follows, blocks, playlists, saved songs and notifications.</li>
        <li>Your XP, coins, achievements, rewards and shop items.</li>
        <li>Your name, email address and profile picture.</li>
      </ul>
      <p>
        Finished battles and the votes in them stay, so other players&apos; results remain correct, but they show as &quot;Deleted user&quot; and can no longer be linked to you.
      </p>

      <h2>Signed in with Facebook?</h2>
      <p>You can also remove VYBZ from Facebook under Settings &amp; privacy → Settings → Apps and websites. That stops Facebook sharing data with VYBZ; to delete what VYBZ has, use the steps above.</p>
    </LegalPage>
  );
}
