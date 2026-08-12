/**
 * Fire-and-forget funnel event tracking (client-side only).
 *
 * Sends a POST to /api/event for conversion-funnel analytics (hero CTA clicks,
 * score submissions, signup attempts/successes). Never throws, never blocks —
 * the endpoint swallows all failures too, so tracking can never break a page.
 * Mirrors recordPageView() in src/routes/__root.tsx.
 *
 * Usage:
 *   trackEvent("hero_cta_click", "hero_primary");
 *   trackEvent("score_submit");
 */
export function trackEvent(event: string, label?: string, path?: string) {
  if (typeof window === "undefined") return;
  const payload: Record<string, string> = { event };
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
