import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { validateSupplierProfile } from "~/lib/suppliers";
import { getOwnSupplierProfile, upsertSupplierProfile } from "~/lib/suppliers.server";

/**
 * GET  /api/suppliers/profile → the signed-in account's own listing (or null)
 * POST /api/suppliers/profile → create or update it (free; owner 2026-10-06, idea #8)
 */
async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in to manage your listing.", needsAccount: true }, { status: 401 });
  try {
    return Response.json({ profile: await getOwnSupplierProfile(user.id), email: user.email });
  } catch (err) {
    console.error("[api/suppliers/profile] read error:", err);
    return Response.json({ error: "Couldn't load your listing." }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in to list your company.", needsAccount: true }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateSupplierProfile(body);
    if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
    await upsertSupplierProfile(user.id, v.profile);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/suppliers/profile] save error:", err);
    return Response.json({ error: "Couldn't save your listing. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/suppliers/profile")({ server: { handlers: { GET: get, POST: post } } });
