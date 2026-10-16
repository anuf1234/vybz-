import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

/**
 * Resend when configured. Without an API key, emails are logged so links can
 * be clicked from the terminal, except on the production deployment, which
 * fails loudly rather than silently dropping verification and reset emails.
 */
export function createEmailSender(env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; VERCEL_ENV?: string }): SendEmail {
  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    const from = env.EMAIL_FROM ?? "VYBZ <no-reply@mail.urexp.com>";
    return async (msg) => {
      const { error } = await resend.emails.send({ from, ...msg });
      if (error) throw new Error(`Email send failed: ${error.name}`);
    };
  }
  if (env.VERCEL_ENV === "production") {
    return async () => {
      throw new Error("RESEND_API_KEY is not configured");
    };
  }
  return async (msg) => {
    console.info(`\n[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
  };
}

export function verificationEmail(url: string): Omit<EmailMessage, "to"> {
  return {
    subject: "Confirm your VYBZ email",
    text: `Confirm your email to start battling:\n\n${url}\n\nIf you didn't sign up for VYBZ, ignore this email.`,
    html: layout(
      "Confirm your email",
      "Tap the button to confirm your email and start battling.",
      url,
      "Confirm email",
      "If you didn't sign up for VYBZ, ignore this email.",
    ),
  };
}

export function resetPasswordEmail(url: string): Omit<EmailMessage, "to"> {
  return {
    subject: "Reset your VYBZ password",
    text: `Reset your password (link expires in 30 minutes):\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
    html: layout(
      "Reset your password",
      "This link expires in 30 minutes.",
      url,
      "Reset password",
      "If you didn't ask for this, ignore this email. Your password won't change.",
    ),
  };
}

function layout(title: string, body: string, url: string, cta: string, footer: string): string {
  const safeUrl = escapeHtml(url);
  return `<!doctype html><html><body style="margin:0;background:#0b0614;color:#f4f0fb;font-family:system-ui,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#140c22;border:1px solid #33224f;border-radius:16px;padding:28px">
<tr><td style="font-weight:700;letter-spacing:.2em">VYBZ</td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:700">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:8px;color:#a59cbb">${escapeHtml(body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${safeUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(cta)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#a59cbb">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
