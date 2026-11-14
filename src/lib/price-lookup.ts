/**
 * "What did this sell for?" — a $9 one-time look at the winning prices behind one bid (owner
 * 2026-11-14: "3", picked from the revenue ideas). It unlocks the bid page's "What similar jobs
 * went for" box (src/components/AreaAwardsBox.tsx) for that one bid: who won each similar federal
 * contract in the state and what each was paid, from USAspending. Members already see it.
 *
 * The purchase is tied to the Stripe checkout session id, kept in the buyer's browser, and to the
 * buyer's email when they are signed in, so it carries to their other devices. It is only offered
 * when there are awards to show: nothing is sold that comes back empty. PURE and client-safe.
 */
export const PRICE_LOOKUP_PRODUCT = "price_lookup";
export const PRICE_LOOKUP_PRICE_CENTS = 900;
export const PRICE_LOOKUP_PRICE_LABEL = "$9";
export const PRICE_LOOKUP_STORAGE_KEY = "cx_price_lookups";
/** Purchases a browser remembers; older ones fall off. */
export const PRICE_LOOKUP_MAX_KEPT = 20;

const SESSION_RE = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/** A Stripe checkout session id, or null. PURE. */
export function lookupSessionId(v: unknown): string | null {
  return typeof v === "string" && SESSION_RE.test(v) ? v : null;
}

/** The valid, distinct session ids in a value (newest last), at most PRICE_LOOKUP_MAX_KEPT. PURE. */
export function cleanLookupSessions(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const x of list) {
    const id = lookupSessionId(x);
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(-PRICE_LOOKUP_MAX_KEPT);
}

/** The stored list (a JSON string or null) with one more id added. PURE. */
export function addLookupSession(stored: string | null, id: string): string {
  let prev: unknown = [];
  try {
    prev = stored ? JSON.parse(stored) : [];
  } catch {
    prev = [];
  }
  return JSON.stringify(cleanLookupSessions([...(Array.isArray(prev) ? prev : []), id]));
}
