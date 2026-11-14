/**
 * The free-account link shown once an address is confirmed (owner 2026-11-14):
 * a confirmed subscriber is the warmest visitor we have, and until now the page
 * only sent them back to Radar. Trade and state from their alert ride the URL so
 * the signup form arrives filled in. NEVER the email (no PII in a URL).
 */
export function signupLinkForLead(profile: unknown): string {
  const p = (profile && typeof profile === "object" ? profile : {}) as { trade?: unknown; state?: unknown };
  const trade = typeof p.trade === "string" ? p.trade.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const state = typeof p.state === "string" ? p.state.trim().toUpperCase() : "";
  const params = new URLSearchParams();
  if (trade && !trade.includes("@")) params.set("trade", trade);
  if (/^[A-Z]{2}$/.test(state)) params.set("state", state);
  const qs = params.toString();
  return `https://www.contrax.company/signup${qs ? `?${qs}` : ""}`;
}
