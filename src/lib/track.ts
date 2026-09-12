import { trackingIds } from "~/lib/visitor";
import { getTrackingUser } from "~/lib/identity";
/**
 * Fire-and-forget funnel event tracking (client-side only).
 *
 * Sends a POST to /api/track-visitor (kind="event") for conversion-funnel
 * analytics (hero CTA clicks, score submissions, signup attempts/successes).
 * Never throws, never blocks — the endpoint swallows all failures too, so
 * tracking can never break a page. Mirrors recordPageView() in
 * src/routes/__root.tsx, which converges on the same single intake endpoint
 * (kind="page"). /api/event stays as a thin forwarder for legacy beacons.
 *
 * Every event carries the persistent per-visitor `contrax_vid` and a
 * per-session `visit` id (see src/lib/visitor.ts) so the whole funnel can be
 * reconstructed per visitor. The intake handler records them (nullable /
 * optional — a cookie-blocked visitor still records events fine).
 *
 * Usage:
 *   trackEvent("hero_cta_click", "hero_primary");
 *   trackEvent("score_submit");
 *
 * The client NEVER sends an attempt id (owner REV 4 gate 1): attempt identity
 * for the signup one-shot family is a SERVER-ISSUED signed token minted into
 * the HttpOnly `signup_attempt` cookie by the /signup SSR loader. Beacons carry
 * it back automatically; the server validates signature+version+expiry and
 * derives the DB idempotency key from it (src/lib/signup-telemetry.ts). Events
 * without a valid cookie record normally with dedupe_key NULL (fail-open,
 * byte-identical behavior).
 */
export function trackEvent(event: string, label?: string, path?: string) {
  if (typeof window === "undefined") return;
  const payload: Record<string, string> = { event, kind: "event" };
  // Persistent per-visitor + per-session identity (first-party, self-hosted).
  // getOrCreateVisitorId() sets the `contrax_vid` cookie on first call so it is
  // in place before/at the first event; the id also rides in the body so the
  // intake handler records it even on the very first hit.
  const ids = trackingIds();
  payload.visitor_id = ids.visitor_id;
  payload.visit_id = ids.visit_id;
  // When the viewer is a logged-in user, carry their identity so the post-login
  // lifecycle stays tied to the account. Anonymous visitors simply omit these
  // fields (never leaked).
  const user = getTrackingUser();
  if (user) {
    payload.user_id = user.id;
    payload.user_email = user.email;
  }
  if (label) payload.label = label;
  if (path) payload.path = path;
  try {
    fetch("/api/track-visitor", {
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
