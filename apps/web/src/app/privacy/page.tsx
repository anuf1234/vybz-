import type { Metadata } from "next";
import { LegalPage, OPERATOR } from "@/components/legal";
import { serverEnv } from "@/server/env";

/** Read SUPPORT_EMAIL when the page is served, not at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  const email = serverEnv().SUPPORT_EMAIL;
  return (
    <LegalPage title="Privacy policy">
      <p>
        VYBZ is a music battle app run by {OPERATOR} (&quot;we&quot;). This policy explains what we collect when you use the VYBZ app or website, why, and the choices you have.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address, display name, handle and profile picture. If you sign in with Google, Facebook, TikTok or Apple, we receive your name, email (if that service shares it) and profile picture from them. We never receive your password for those services.
        </li>
        <li>
          <strong>What you do in VYBZ:</strong> battles you create or join, songs you pick, votes, listening progress used to unlock voting, reactions, chat messages, posts, comments, likes, follows, direct messages, playlists, saved songs, rewards and settings.
        </li>
        <li>
          <strong>Device information:</strong> a push-notification token if you allow notifications, your time zone (for daily rewards), and basic technical logs such as IP address and request times, kept to run and protect the service.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run VYBZ: accounts, battles, voting, feeds, messages, notifications, leaderboards and rewards.</li>
        <li>To keep it fair and safe: preventing vote fraud and spam, and reviewing reports.</li>
        <li>To fix problems and improve the app.</li>
      </ul>
      <p>We don&apos;t sell your personal information, and we don&apos;t use it for third-party advertising.</p>

      <h2>Who sees what</h2>
      <ul>
        <li>Your handle, display name, profile picture, public battles, posts, comments, chat messages, public playlists, followers and achievements are visible to other people.</li>
        <li>Direct messages are visible only to you and the person you&apos;re talking with, and to our moderators when a message is reported.</li>
        <li>
          Service providers who help us run VYBZ process data for us: hosting (Render), email delivery, push notifications (Expo), music catalogs and playback (Apple Music, YouTube), GIF search (GIPHY), and, for AI-judged battles, the AI model provider (Anthropic), which receives song details but not who picked them.
        </li>
        <li>We may share information if the law requires it or to protect people&apos;s safety.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>We keep your information while your account exists. When you delete your account, we delete your personal content and connections, as described on the <a href="/data-deletion">data deletion page</a>.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile at any time, and turn notifications off in your phone&apos;s settings.</li>
        <li>Delete your account in the app: Profile → Delete account.</li>
        <li>Ask us for a copy of your data or to correct it by emailing <a href={`mailto:${email}`}>{email}</a>.</li>
      </ul>

      <h2>Children</h2>
      <p>VYBZ isn&apos;t meant for children under 13, and we don&apos;t knowingly collect information from them. If you believe a child under 13 has an account, contact us and we&apos;ll delete it.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a meaningful way, we&apos;ll tell you in the app before the change takes effect.</p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>
    </LegalPage>
  );
}
