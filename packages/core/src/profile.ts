import { z } from "zod";
import { GENRES } from "./battle/rules";

/**
 * Handles that would impersonate staff, collide with routes, or confuse
 * people. Checked after normalization, so "Admin" and "ADMIN" are caught too.
 */
const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "battle",
  "battles",
  "create",
  "discover",
  "my",
  "notifications",
  "profile",
  "results",
  "help",
  "login",
  "logout",
  "me",
  "mod",
  "moderator",
  "official",
  "onboarding",
  "root",
  "search",
  "settings",
  "signin",
  "signup",
  "staff",
  "support",
  "system",
  "u",
  "urexp",
  "vybz",
  "vybzofficial",
]);

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export const HandleSchema = z
  .string()
  .transform(normalizeHandle)
  .pipe(
    z
      .string()
      .min(3, "Handles need at least 3 characters.")
      .max(20, "Handles can be at most 20 characters.")
      .regex(/^[a-z0-9_]+$/, "Use only letters, numbers and underscores.")
      .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved."),
  );

/** Plain text only: we never render profile text as HTML. */
const plainText = (max: number) =>
  z
    .string()
    // Strip control characters (except newlines) that could break layouts, then trim.
    .transform((s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));

export const DisplayNameSchema = plainText(40).pipe(z.string().min(1, "Add a display name."));

export const ProfileUpdateSchema = z.object({
  name: DisplayNameSchema,
  bio: plainText(160).transform((s) => (s.length === 0 ? null : s)),
  favoriteGenres: z.array(z.enum(GENRES)).max(5, "Pick up to 5 genres.").default([]),
});

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
