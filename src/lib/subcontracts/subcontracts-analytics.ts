/**
 * Contrax — SUBCONTRACTING preview: the analytics contract (owner decision 5,
 * 2026-09-25; BUILD-PLAN.md §5).
 *
 * FIVE event names, and no more. They ride the app's ONE canonical client-side
 * writer (`trackEvent` → POST /api/track-visitor, kind="event"), so they inherit
 * the existing discipline for free: the intake handler's `isBot()` filter, the 1 s
 * write-time collapse on (event + visitor + path), the QA/admin/test exclusions,
 * and the persistent contrax_vid / visit_id identity. Nothing new is invented here,
 * and NO server-side subcontract endpoint writes analytics.
 *
 * ISOLATION CONTRACT: none of these names appears in any funnel-stage set
 * (ACTIVATION_EVENTS, the Radar conversion/leads funnels, the Bid Scout funnels, the
 * autopsy funnel, the admin unified funnel). They are display-only rows in
 * `funnel_events`, exactly like `grants_*` / `bid_scout_viewed` / `autopsy_home_cta`:
 * opening a subcontracting notice never synthesizes radar_completed,
 * signup_completed, activated or paid. `subcontracts-analytics.test.ts` asserts this
 * both against the exported sets and against the funnel sources' own text.
 *
 * `path` is "/subcontracts" on every one of them, so the 1 s collapse groups a
 * card's clicks the way the Grants events group theirs.
 *
 * `subcontracts_checkout_started` IS DELIBERATELY INERT. The owner approved the name
 * (decision 5: "any future checkout CTA must be named subcontracts_checkout_started
 * and stay display-only") and there is NO checkout surface for subcontracting — no
 * price, no Stripe product, nothing to buy — so nothing may ever fire it. It is
 * REGISTERED so the name cannot be re-invented differently later, and named in
 * INERT_SUBCONTRACTS_EVENTS so the test can prove it is unreferenced by the client.
 */
import { trackEvent } from "~/lib/track";

export const SUBCONTRACTS_EVENTS = {
  /** Page view. NO label (the page is the label). */
  pageViewed: "subcontracts_page_viewed",
  /** One notice entered the viewport — fired ONCE per notice, label = external_id. */
  noticeViewed: "subcontracts_notice_viewed",
  /** The draft's own name, kept: "View original SBA notice →", label = external_id. */
  sourceOpen: "subcontract_source_open",
  /** The draft's own name, kept: the prime's mailto link, label = external_id. */
  contactClick: "subcontract_contact_click",
  /** DEFINED BUT INERT — see the module comment. Never fired: there is no checkout. */
  checkoutStarted: "subcontracts_checkout_started",
} as const;

export type SubcontractsEventName =
  (typeof SUBCONTRACTS_EVENTS)[keyof typeof SUBCONTRACTS_EVENTS];

/** All five names, for the isolation assertions + the EVENT_LABELS registry. */
export const SUBCONTRACTS_EVENT_NAMES: readonly string[] = Object.values(SUBCONTRACTS_EVENTS);

/** The names that must never be fired by any client code (no surface exists for them). */
export const INERT_SUBCONTRACTS_EVENTS: readonly string[] = [SUBCONTRACTS_EVENTS.checkoutStarted];

/** The page path every subcontract event is stamped with (part of the 1 s dedupe key). */
export const SUBCONTRACTS_PAGE_PATH = "/subcontracts";

/**
 * Fires one subcontract event through the shared writer. Never throws, never blocks,
 * and is a no-op during SSR (trackEvent itself guards on `window`). `label` is
 * omitted entirely for the page view rather than sent as an empty string.
 */
export function trackSubcontractsEvent(event: SubcontractsEventName, label?: string): void {
  if (label === undefined) trackEvent(event, undefined, SUBCONTRACTS_PAGE_PATH);
  else trackEvent(event, label, SUBCONTRACTS_PAGE_PATH);
}

/**
 * The once-per-notice guard for `subcontracts_notice_viewed`. IntersectionObserver
 * fires repeatedly for one card (scroll in, out, in) and a re-render mounts a fresh
 * observer, so the "once" must live in a set the caller owns rather than in the
 * trigger. Returns true only for the first sighting of a non-empty id — an event
 * with no label is not fired at all, because a row we cannot attribute is worse than
 * no row.
 */
export function shouldFireNoticeView(seen: Set<string>, externalId: string | null | undefined): boolean {
  const id = (externalId ?? "").trim();
  if (!id) return false;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}
