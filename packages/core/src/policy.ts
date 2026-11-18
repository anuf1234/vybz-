/**
 * Role-based authorization. Pure and checked server-side in every handler.
 * Resource rules (e.g. "not in your own battle") live in the engine and voting.
 */

export type Role = "USER" | "CREATOR" | "MODERATOR" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";

export interface Actor {
  userId: string;
  role: Role;
  status: AccountStatus;
  emailVerified: boolean;
}

export type Action =
  | "battle.view"
  | "battle.create"
  | "battle.accept"
  | "battle.cancel"
  | "battle.submit"
  | "battle.listen"
  | "battle.vote"
  | "profile.update"
  | "battle.void";

export type Decision = { allow: true } | { allow: false; reason: "SIGN_IN_REQUIRED" | "ACCOUNT_RESTRICTED" | "EMAIL_NOT_VERIFIED" | "FORBIDDEN" };

const ALLOW: Decision = { allow: true };

const STAFF: readonly Role[] = ["MODERATOR", "ADMIN"];

export function can(actor: Actor | null, action: Action, opts: { requireVerifiedEmail?: boolean } = {}): Decision {
  if (action === "battle.view") return ALLOW;
  if (!actor) return { allow: false, reason: "SIGN_IN_REQUIRED" };
  if (actor.status !== "ACTIVE") return { allow: false, reason: "ACCOUNT_RESTRICTED" };

  if (action === "battle.void") return STAFF.includes(actor.role) ? ALLOW : { allow: false, reason: "FORBIDDEN" };
  if (action === "profile.update" || action === "battle.listen") return ALLOW;

  // Battling needs a verified email (when the deployment requires verification).
  // Voting eligibility is decided per battle in checkVote.
  if (action !== "battle.vote" && opts.requireVerifiedEmail && !actor.emailVerified) {
    return { allow: false, reason: "EMAIL_NOT_VERIFIED" };
  }
  return ALLOW;
}
