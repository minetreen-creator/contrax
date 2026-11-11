/**
 * Checkout attribution (owner 2026-11-04, after the first $5 sale). The buyer
 * paid first and got an account 11 seconds later, so their visit (pages,
 * searches, events, all keyed by the `contrax_vid` visitor cookie) was never
 * tied to the account, and Mission Control showed "Checkouts 0" beside "Paid $5"
 * because the browser's "sent to Stripe" beacon is lost when the page leaves.
 *
 *  - When a checkout session is created, the SERVER records
 *    `checkout_session_created` (visitor, account, plan) and stamps the visitor
 *    id on the Stripe session's metadata.
 *  - When Stripe confirms the payment, the webhook links that visitor's last
 *    30 days of page views, events and Radar searches to the account.
 * Both never throw: attribution must never fail a checkout or a payment.
 */
import { sql } from "~/db";
import { parseAttributionCookie } from "~/lib/attribution";

/** Same name as VISITOR_COOKIE_NAME in ~/lib/visitor (pinned by the test). */
export const VISITOR_COOKIE = "contrax_vid";
const VISITOR_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function visitorIdFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  for (const part of String(cookieHeader ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === VISITOR_COOKIE) {
      const id = decodeURIComponent(v.join("=")).trim();
      return VISITOR_ID_RE.test(id) ? id : null;
    }
  }
  return null;
}

export const CHECKOUT_OPENED_EVENT = "checkout_session_created";

export async function recordCheckoutOpened(o: {
  visitorId: string | null;
  userId: number | null;
  label: string;
  ip?: string | null;
  userAgent?: string | null;
  /** The request's Cookie header: where the visitor came from (contrax_attr) is stored with the event. */
  cookieHeader?: string | null;
}): Promise<void> {
  try {
    // Same first-touch source every page view and browser event carries (owner 2026-11-11: 8 of 12
    // "Stripe opens" were ad-click robots, counted because this row had no source to filter on).
    const attr = parseAttributionCookie(o.cookieHeader);
    await sql()`INSERT INTO funnel_events (event_name, label, path, visitor_id, user_id, ip, user_agent, source, medium, campaign, click_id)
      VALUES (${CHECKOUT_OPENED_EVENT}, ${o.label}, ${"/api/stripe/create-checkout-session"}, ${o.visitorId},
              ${o.userId == null ? null : String(o.userId)}, ${o.ip ?? null}, ${o.userAgent ?? null},
              ${attr?.source ?? null}, ${attr?.medium ?? null}, ${attr?.campaign ?? null}, ${attr?.click_id ?? null})`;
  } catch (e) {
    console.error("[checkout-attribution] record failed (non-fatal):", (e as Error).message);
  }
}

/** Tie a paying visitor's recent anonymous history to their account. */
export async function linkVisitorToUser(visitorId: string | null | undefined, userId: number): Promise<void> {
  if (!visitorId || !VISITOR_ID_RE.test(visitorId)) return;
  const uid = String(userId);
  try {
    await sql()`UPDATE page_views SET user_id = ${uid}
      WHERE visitor_id = ${visitorId} AND user_id IS NULL AND created_at > NOW() - INTERVAL '30 days'`;
    await sql()`UPDATE funnel_events SET user_id = ${uid}
      WHERE visitor_id = ${visitorId} AND user_id IS NULL AND created_at > NOW() - INTERVAL '30 days'`;
    await sql()`UPDATE radar_search_log SET user_id = ${userId}
      WHERE visitor_id = ${visitorId} AND user_id IS NULL AND created_at > NOW() - INTERVAL '30 days'`;
  } catch (e) {
    console.error("[checkout-attribution] link failed (non-fatal):", (e as Error).message);
  }
}
