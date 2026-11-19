import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { serverEnv } from "@/server/env";

/** Read SUPPORT_EMAIL when the page is served, not at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Support" };

/** The App Store "Support URL". */
export default function Support() {
  const email = serverEnv().SUPPORT_EMAIL;
  return (
    <LegalPage title="VYBZ support">
      <p>
        Need help with VYBZ? Email <a href={`mailto:${email}`}>{email}</a> and we&apos;ll get back to you within two business days. Tell us your handle and what happened, and add a screenshot if you can.
      </p>

      <h2>Common questions</h2>
      <ul>
        <li>
          <strong>Songs won&apos;t play in full.</strong> Full tracks need an Apple Music subscription: connect it in Profile → Apple Music. Without one you hear 30-second previews.
        </li>
        <li>
          <strong>I can&apos;t vote yet.</strong> Listen to each pick in the round first. Voting unlocks once you&apos;ve heard them.
        </li>
        <li>
          <strong>VYBZ Pro.</strong> Manage or cancel your subscription in your iPhone&apos;s Settings → your name → Subscriptions. On a new phone, open VYBZ Pro and tap Restore purchases.
        </li>
        <li>
          <strong>Report someone.</strong> Open their profile, post or message and tap Report. Our moderators review every report. You can also block them from their profile.
        </li>
        <li>
          <strong>Delete your account.</strong> In the app: Profile → Delete account. See the <a href="/data-deletion">data deletion page</a> for what gets removed.
        </li>
      </ul>

      <p>
        Read our <a href="/privacy">privacy policy</a> and <a href="/terms">terms</a>.
      </p>
    </LegalPage>
  );
}
