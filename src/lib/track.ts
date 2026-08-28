import { trackingIds } from "~/lib/visitor";
/**
 * Fire-and-forget funnel event tracking (client-side only).
 *
 * Sends a POST to /api/event for conversion-funnel analytics (hero CTA clicks,
 * score submissions, signup attempts/successes). Never throws, never blocks —
 * the endpoint swallows all failures too, so tracking can never break a page.
 * Mirrors recordPageView() in src/routes/__root.tsx.
 *
 * Every event carries the persistent per-visitor `contrax_vid` and a
 * per-session `visit` id (see src/lib/visitor.ts) so the whole funnel can be
 * reconstructed per visitor. The /api/event handler records them (nullable /
 * optional — a cookie-blocked visitor still records events fine).
 *
 * Usage:
 *   trackEvent("hero_cta_click", "hero_primary");
 *   trackEvent("score_submit");
 */
export function trackEvent(event: string, label?: string, path?: string) {
  if (typeof window === "undefined") return;
  const payload: Record<string, string> = { event };
  // Persistent per-visitor + per-session identity (first-party, self-hosted).
  // getOrCreateVisitorId() sets the `contrax_vid` cookie on first call so it is
  // in place before/at the first event; the id also rides in the body so the
  // /api/event handler records it even on the very first hit.
  const ids = trackingIds();
  payload.visitor_id = ids.visitor_id;
  payload.visit_id = ids.visit_id;
  if (label) payload.label = label;
  if (path) payload.path = path;
  try {
    fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* fire-and-forget — never surface tracking failures */
    });
  } catch {
    /* never let tracking break rendering */
  }
}
