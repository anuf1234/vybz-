/**
 * Authorization policy. Pure functions, no I/O: every Server Action and Route
 * Handler loads the actor and resource, then asks `can()`. UI hiding and
 * middleware redirects are conveniences, never the check.
 */

export type Role = "USER" | "CREATOR" | "MODERATOR" | "ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";

export interface Actor {
  id: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  handle: string | null;
}

/** `null` actor = guest (no session). */
export type MaybeActor = Actor | null;

export type Action =
  | { type: "profile.view"; target: { id: string; status: UserStatus } }
  | { type: "profile.update"; target: { id: string } }
  | { type: "profile.setHandle"; target: { id: string; handle: string | null } }
  | { type: "user.setRole"; target: { id: string } }
  | { type: "user.suspend"; target: { id: string; role: Role } }
  | { type: "battle.create" }
  | { type: "vote.cast" }
  | { type: "media.upload" };

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

export type DenyReason =
  | "SIGN_IN_REQUIRED"
  | "EMAIL_UNVERIFIED"
  | "ONBOARDING_REQUIRED"
  | "ACCOUNT_RESTRICTED"
  | "NOT_OWNER"
  | "HANDLE_ALREADY_SET"
  | "INSUFFICIENT_ROLE"
  | "NOT_FOUND";

const RANK: Record<Role, number> = { USER: 0, CREATOR: 1, MODERATOR: 2, ADMIN: 3 };

export function hasRole(actor: MaybeActor, min: Role): boolean {
  return actor !== null && RANK[actor.role] >= RANK[min];
}

const allow: Decision = { allow: true };
const deny = (reason: DenyReason): Decision => ({ allow: false, reason });

export function can(actor: MaybeActor, action: Action): Decision {
  // Public reads. Banned profiles are hidden from everyone but staff.
  if (action.type === "profile.view") {
    if (action.target.status === "BANNED" && !hasRole(actor, "MODERATOR")) return deny("NOT_FOUND");
    return allow;
  }

  if (!actor) return deny("SIGN_IN_REQUIRED");
  if (actor.status === "BANNED") return deny("ACCOUNT_RESTRICTED");

  switch (action.type) {
    case "profile.update":
      // Suspended users may still edit their own profile (e.g. to fix what got them suspended).
      return actor.id === action.target.id ? allow : deny("NOT_OWNER");

    case "profile.setHandle":
      if (actor.id !== action.target.id) return deny("NOT_OWNER");
      // Handles are permanent once chosen in Phase 0; renames come with a cooldown later.
      return action.target.handle === null ? allow : deny("HANDLE_ALREADY_SET");

    case "user.setRole":
      // Only admins change roles, and never their own.
      if (!hasRole(actor, "ADMIN") || actor.id === action.target.id) return deny("INSUFFICIENT_ROLE");
      return allow;

    case "user.suspend":
      if (!hasRole(actor, "MODERATOR") || actor.id === action.target.id) return deny("INSUFFICIENT_ROLE");
      // Moderators can't suspend peers or admins.
      return RANK[actor.role] > RANK[action.target.role] ? allow : deny("INSUFFICIENT_ROLE");

    case "battle.create":
    case "vote.cast":
      return participationGate(actor);

    case "media.upload": {
      const gate = participationGate(actor);
      if (!gate.allow) return gate;
      return hasRole(actor, "CREATOR") ? allow : deny("INSUFFICIENT_ROLE");
    }
  }
}

/** Battling and voting need a verified, onboarded, unrestricted account. */
function participationGate(actor: Actor): Decision {
  if (actor.status !== "ACTIVE") return deny("ACCOUNT_RESTRICTED");
  if (!actor.emailVerified) return deny("EMAIL_UNVERIFIED");
  if (!actor.handle) return deny("ONBOARDING_REQUIRED");
  return allow;
}
