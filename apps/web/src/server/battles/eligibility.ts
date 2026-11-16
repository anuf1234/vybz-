import type { VoterFacts } from "@vybz/core";
import type { schema } from "@vybz/db";

/**
 * Eligibility facts for a voter. A battle's "verified email" rule only applies
 * when this deployment verifies emails; otherwise nobody could ever satisfy it.
 */
export function voterFacts(u: (typeof schema.user.$inferSelect) | null, deploymentVerifiesEmail: boolean): VoterFacts | null {
  return u ? { userId: u.id, emailVerified: u.emailVerified || !deploymentVerifiesEmail, createdAt: u.createdAt, status: u.status } : null;
}
