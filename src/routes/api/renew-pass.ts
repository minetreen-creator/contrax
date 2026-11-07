import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/renew-pass?t=… — the "Keep my bid emails ($19/month)" button in the
 * $5 pass reminder (owner 2026-11-07, "2 only"). The signed token names one
 * account and expires 14 days after its pass ends. It opens a monthly Starter
 * checkout at full price for that account and redirects to Stripe; nothing is
 * charged unless the buyer completes Stripe's page. Any problem falls back to
 * the normal /upgrade page, so the button never dead-ends.
 */
const FALLBACK = "https://www.contrax.company/upgrade?plan=starter&source=pass_reminder";
const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

async function handler({ request }: { request: Request }) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const { verifyPassRenewToken } = await import("~/lib/starter-pass.server");
  let userId: number | null = null;
  try {
    userId = token.length <= 400 ? verifyPassRenewToken(token) : null;
  } catch (e) {
    console.error("[renew-pass] token check failed:", (e as Error).message);
  }
  if (userId == null) return redirect(FALLBACK);
  try {
    const { sql } = await import("~/db");
    const [u] = (await sql()`
      SELECT id, subscription_status, starter_pass_ends_at FROM users WHERE id = ${userId}
    `) as { id: number; subscription_status: string | null; starter_pass_ends_at: string | Date | null }[];
    if (!u) return redirect(FALLBACK);
    // Already subscribed (a subscription clears the pass): nothing to buy.
    if (u.subscription_status === "active" && !u.starter_pass_ends_at) return redirect("https://www.contrax.company/dashboard?renewed=already");
    const { createCheckoutSession } = await import("~/lib/stripe");
    const result = await createCheckoutSession("starter", { userId: u.id, fullPrice: true, mode: "subscription", interval: "month" });
    if (!result.success || !result.url) {
      console.error("[renew-pass] checkout failed:", result.success ? "no url" : result.error);
      return redirect(FALLBACK);
    }
    return redirect(result.url);
  } catch (e) {
    console.error("[renew-pass] failed:", (e as Error).message);
    return redirect(FALLBACK);
  }
}

export const Route = createFileRoute("/api/renew-pass")({ server: { handlers: { GET: handler } } });
