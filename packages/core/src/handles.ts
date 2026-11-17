import { z } from "zod";

export const RESERVED_HANDLES = new Set([
  "admin", "api", "app", "battle", "battles", "help", "me", "mod", "moderator", "root", "settings", "support", "system", "vybz", "urexp",
]);

export const HandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "3–20 letters, numbers or underscores")
  .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved");

export const DisplayNameSchema = z.string().trim().min(1).max(40);

/** A starting handle from an email or name; uniqueness is resolved by the caller. */
export function suggestHandle(seed: string): string {
  const base = seed.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
  return base.length >= 3 && !RESERVED_HANDLES.has(base) ? base : "listener";
}
