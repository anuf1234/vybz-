import type { Metadata } from "next";
import { LegalPage, OPERATOR } from "@/components/legal";
import { serverEnv } from "@/server/env";

/** Read SUPPORT_EMAIL when the page is served, not at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Terms of service" };

export default function Terms() {
  const email = serverEnv().SUPPORT_EMAIL;
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are an agreement between you and {OPERATOR} for your use of VYBZ. By using VYBZ you agree to them. If you don&apos;t agree, please don&apos;t use VYBZ.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old, and old enough in your country to agree to these terms.</li>
        <li>Keep your sign-in secure. You&apos;re responsible for what happens on your account.</li>
        <li>One person, one account. Don&apos;t impersonate anyone.</li>
      </ul>

      <h2>Playing fair</h2>
      <ul>
        <li>Don&apos;t manipulate votes: no fake accounts, vote trading, bots or automated listening.</li>
        <li>Don&apos;t harass, threaten or spam people, or post hateful, sexual or illegal content.</li>
        <li>We may hide content, void battles, and suspend or close accounts that break these rules.</li>
      </ul>

      <h2>Music and other content</h2>
      <ul>
        <li>
          Songs in VYBZ play through the services that hold the rights to them (such as Apple Music and YouTube) and are subject to those services&apos; terms. VYBZ doesn&apos;t host or sell music, and you may not record, download or rebroadcast it through VYBZ.
        </li>
        <li>GIFs come from GIPHY and are subject to GIPHY&apos;s terms.</li>
        <li>
          You keep ownership of what you post. You give us a license to host, show and share it within VYBZ (including in share cards and link previews) so the service works. You&apos;re responsible for having the right to post it.
        </li>
      </ul>

      <h2>XP, coins and rewards</h2>
      <p>XP, coins, levels, achievements and shop items have no money value, can&apos;t be bought or sold for money, and can&apos;t be exchanged outside VYBZ. We may adjust them to fix mistakes or abuse.</p>

      <h2>The service</h2>
      <ul>
        <li>VYBZ is provided &quot;as is.&quot; We work to keep it running but can&apos;t promise it will always be available or error-free, and features may change.</li>
        <li>To the extent the law allows, we aren&apos;t liable for indirect or consequential losses arising from your use of VYBZ.</li>
        <li>You can stop using VYBZ and delete your account at any time.</li>
      </ul>

      <h2>Changes</h2>
      <p>We may update these terms. If a change is significant, we&apos;ll tell you in the app before it takes effect. Continuing to use VYBZ after that means you accept the new terms.</p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>
    </LegalPage>
  );
}
