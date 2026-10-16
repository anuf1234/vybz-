"use client";

import { useState } from "react";
import { buttonClass } from "./button";

/** Native share sheet on phones, copy-link everywhere else. */
export function ShareButton({ path, title, text, label = "Share" }: { path: string; title: string; text?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ url, title, ...(text ? { text } : {}) });
        return;
      } catch {
        // Cancelled or blocked: fall through to copying.
      }
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={share} className={buttonClass("ghost", "sm")} aria-live="polite">
      {copied ? "Link copied" : label}
    </button>
  );
}
