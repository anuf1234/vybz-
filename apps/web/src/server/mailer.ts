export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

/** Resend when configured, otherwise the console (development). */
export function createMailer(opts: { resendApiKey?: string; from: string; fetch?: typeof fetch }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  if (!opts.resendApiKey) {
    return async (mail) => {
      console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    };
  }
  return async (mail) => {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: opts.from, to: mail.to, subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`email send failed: ${res.status}`);
  };
}
