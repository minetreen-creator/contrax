import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { computeTrialStatus } from "~/lib/trial";
import { loadOpenBids, matchingBids, primaryProfile, trialRecapFor, type OpenBid } from "~/lib/trial-recap.server";

/**
 * GET /api/trial-recap (owner 2026-10-19) — for a member whose trial ended
 * without payment: their own counts plus the next few matching bids their
 * paused daily email would have carried (title and due date only).
 * Anyone else gets { show: false }.
 */
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; bids: OpenBid[] } | null = null;
async function openBids(): Promise<OpenBid[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), bids: await loadOpenBids() };
  return cache.bids;
}

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
    const rows = (await sql()`
      SELECT plan_tier, trial_started_at, subscription_status, access_expires_at, full_access FROM users WHERE id = ${user.id}
    `) as { plan_tier: string | null; trial_started_at: string | null; subscription_status: string | null; access_expires_at: string | null; full_access: boolean }[];
    const r = rows[0];
    const status = r ? computeTrialStatus(r.trial_started_at, r.plan_tier, r.subscription_status, r.access_expires_at, r.full_access) : null;
    if (!status?.trialEnded) return Response.json({ show: false });

    const [profile, open] = await Promise.all([primaryProfile(user.id), openBids()]);
    const recap = await trialRecapFor(user.id, profile, open);
    const next = matchingBids(profile, open).bids.slice(0, 3).map((b) => ({ id: b.id, title: b.title, dueAt: new Date(b.dueAt).toISOString() }));
    return Response.json({ show: true, recap, next });
  } catch (error) {
    console.error("[api/trial-recap] error:", error);
    return Response.json({ show: false });
  }
}

export const Route = createFileRoute("/api/trial-recap")({
  server: { handlers: { GET: handler } },
});
