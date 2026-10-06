/**
 * Who may see supplier contact details (owner 2026-10-06, idea #8): the owner,
 * and accounts with an active Prime Access plan (or an owner-granted plan).
 */
import { tierHasSupplierContacts } from "~/lib/data-feed-billing.server";
import { dataPlanForUser } from "~/lib/data-feed.server";

export async function canSeeSupplierContacts(user: { id: number; is_admin?: boolean } | null): Promise<boolean> {
  if (!user) return false;
  if (user.is_admin) return true;
  const plan = await dataPlanForUser(user.id);
  return !!plan && tierHasSupplierContacts(plan.tier);
}
