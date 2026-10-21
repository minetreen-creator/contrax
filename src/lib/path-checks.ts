/**
 * Daily money-path check (owner 2026-10-20, item 6): the pages a visitor
 * passes through on the way to paying, fetched once a day from outside. A
 * check passes when the page answers with the expected status and contains
 * text that only renders when the page works. The checkout check expects a
 * 401: a signed-out request must be refused cleanly, not crash.
 *
 * PURE and client-safe. The job is src/jobs/path-check.ts; results are stored
 * by path-checks.server.ts and shown on /admin.
 */

export interface PathCheck {
  name: string;
  path: string;
  method?: "GET" | "POST";
  body?: string;
  expectStatus: number;
  /** Text the response must contain. */
  mustContain: string;
}

export const PATH_CHECKS: readonly PathCheck[] = [
  { name: "Homepage", path: "/", expectStatus: 200, mustContain: "first-contract-title" },
  { name: "Search page", path: "/radar", expectStatus: 200, mustContain: "See my matches" },
  { name: "Signup", path: "/signup?plan=basic", expectStatus: 200, mustContain: "Continue with Google" },
  { name: "Sign in", path: "/login", expectStatus: 200, mustContain: "Password" },
  { name: "Pricing", path: "/pricing", expectStatus: 200, mustContain: "Start Starter for $" },
  { name: "Plan page", path: "/upgrade", expectStatus: 200, mustContain: "Keep going with Contrax" },
  {
    name: "Checkout (signed out is refused)",
    path: "/api/stripe/create-checkout-session",
    method: "POST",
    body: JSON.stringify({ plan: "starter", interval: "month" }),
    expectStatus: 401,
    mustContain: "Sign in",
  },
];

export interface PathCheckResult {
  name: string;
  path: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  detail: string | null;
}

/** Judge one response. `status` null = the request itself failed (`error`). */
export function judge(check: PathCheck, status: number | null, body: string, ms: number | null, error?: string): PathCheckResult {
  const base = { name: check.name, path: check.path, status, ms };
  if (status == null) return { ...base, ok: false, detail: error || "No response" };
  if (status !== check.expectStatus) return { ...base, ok: false, detail: `Expected ${check.expectStatus}, got ${status}` };
  if (!body.includes(check.mustContain)) return { ...base, ok: false, detail: `Page loaded but "${check.mustContain}" is missing` };
  return { ...base, ok: true, detail: null };
}

/** Hours after which the last run counts as missing (one daily run plus slack). */
export const STALE_AFTER_HOURS = 36;

export type SiteCheckState = "ok" | "failing" | "stale" | "never";

export function siteCheckState(lastRunAt: string | null, failed: number, now: number = Date.now()): SiteCheckState {
  if (!lastRunAt) return "never";
  if (failed > 0) return "failing";
  return now - new Date(lastRunAt).getTime() > STALE_AFTER_HOURS * 3_600_000 ? "stale" : "ok";
}
