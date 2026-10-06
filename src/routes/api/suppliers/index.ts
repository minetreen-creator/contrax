import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { parseSupplierQuery } from "~/lib/suppliers";
import { canSeeSupplierContacts } from "~/lib/suppliers-access.server";
import { countListedSuppliers, listSuppliers } from "~/lib/suppliers.server";

/**
 * GET /api/suppliers?naics=2382&state=VA&cert=SDVOSB&q=hvac — the small-business
 * supplier directory (owner 2026-10-06, idea #8). Contact fields are filled only
 * for Prime Access accounts and the owner; everyone else gets them as null.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    const withContacts = await canSeeSupplierContacts(user);
    const q = parseSupplierQuery(new URL(request.url).searchParams);
    const [suppliers, total] = await Promise.all([listSuppliers(q, withContacts), countListedSuppliers()]);
    return Response.json({ suppliers, total, withContacts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/suppliers] error:", err);
    return Response.json({ error: "Directory unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/suppliers/")({ server: { handlers: { GET: handler } } });
