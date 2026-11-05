import { createFileRoute } from "@tanstack/react-router";
import { validatePartnerForm } from "~/lib/association-partner";

/**
 * POST /api/partners/checkout — the $149/month Association Partner checkout
 * (owner 2026-11-05). Body: the /associations form. Returns { url } (Stripe).
 */
async function post({ request }: { request: Request }) {
  const body = await request.json().catch(() => ({}));
  const v = validatePartnerForm(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const { createPartnerCheckout } = await import("~/lib/association-partner.server");
    return Response.json({ url: await createPartnerCheckout(v.value) });
  } catch (err) {
    console.error("[api/partners/checkout] failed:", err);
    return Response.json({ error: "Checkout is unavailable right now. Please email hello@contrax.company and we'll set it up." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/partners/checkout")({ server: { handlers: { POST: post } } });
