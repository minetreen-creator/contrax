/**
 * Server half of the paid head start (head-start.ts): does this viewer have
 * paid access to new bids? Same rule as the daily email (digest-recipients.ts):
 * admins, active Bid Scout subscribers, active full-access grants, the demo
 * account, and Starter-or-above plans that have not expired (a paid
 * subscription never expires; a trial counts while it runs).
 *
 * Fails CLOSED to "not paid" on any lookup error — the worst case is a paying
 * member briefly seeing a lock, never a free viewer getting the link.
 */
import { neonGateStores, type GateStores } from "./plan-gates.server";
import { hasUnlimitedSaves } from "./trial";

export async function hasPaidBidAccess(
  user: { id?: number | string | null; is_admin?: boolean } | null | undefined,
  stores: GateStores = neonGateStores,
): Promise<boolean> {
  if (!user || user.id == null) return false;
  if (user.is_admin) return true;
  const userId = Number(user.id);
  if (!Number.isFinite(userId)) return false;
  try {
    if (hasUnlimitedSaves(await stores.trialStatus.load(userId), user)) return true;
    return await stores.bidScout.hasActiveSubscription(userId);
  } catch (err) {
    console.error("[head-start] paid-access lookup failed (treated as not paid):", (err as Error).message);
    return false;
  }
}
