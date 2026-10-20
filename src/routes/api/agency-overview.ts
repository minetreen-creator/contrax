/**
 * GET /api/agency-overview — the CROSS-CLIENT DASHBOARD endpoint (Agency tier
 * phase 2, owner decision 2026-10-20).
 *
 * GET → { window, workspaces: WorkspaceRollup[], totals }
 *   window.today .. window.weekEnd   the inclusive 7-day "due soon" range
 *   workspaces[]                     one row per client workspace the caller owns,
 *                                    attention-first (overdue → due soon → advancing)
 *   totals                           account-wide sums over those rows
 *
 * AUTH: 401 with no session, exactly like /api/workspaces — the dashboard is inside
 * the authenticated app, never a public surface.
 *
 * READS ARE NOT ENTITLEMENT-GATED (the phase-1 rule, deliberately kept): a
 * downgraded Agency account still sees the clients it already has, the same way it
 * still GETs /api/workspaces and still reads its saved bids and contacts. This
 * endpoint also has no write path and no cap arithmetic of its own — it shows what
 * phase 1 already scoped, so `computeWorkspaceAccess` / `canAddWorkspace` /
 * `workspaceScopeClause` stay exactly where they are. Nothing new is granted.
 *
 * The `deps` seam exists for the CRM/workspaces reason: a unit test drives the REAL
 * handler with an in-memory store (and a frozen clock) instead of `mock.module`,
 * whose registry is process-global and leaks across test files.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { buildAgencyOverview, dayWindow } from "~/lib/agency-overview";
import { neonAgencyOverviewStore, type AgencyOverviewStore } from "~/lib/agency-overview.server";

/** The authenticated caller, as much of it as this endpoint needs. */
export type AgencyOverviewRouteUser = { id: number; is_admin?: boolean };

export interface AgencyOverviewRouteDeps {
  authenticate?: (request: Request) => Promise<AgencyOverviewRouteUser | null>;
  store?: AgencyOverviewStore;
  /** Clock seam: the window must be pinnable in a test. Defaults to `new Date()`. */
  now?: () => Date;
}

interface ResolvedDeps {
  authenticate: (request: Request) => Promise<AgencyOverviewRouteUser | null>;
  store: AgencyOverviewStore;
  now: () => Date;
}

async function get(deps: ResolvedDeps, { request }: { request: Request }) {
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const window = dayWindow(deps.now());
  try {
    const stats = await deps.store.rollup(user.id, window);
    return Response.json(buildAgencyOverview(stats, window));
  } catch (error) {
    console.error("[api/agency-overview] read failed", error);
    return Response.json({ error: "Could not load your client overview" }, { status: 500 });
  }
}

/** Builds the endpoint's handlers around `deps` (production defaults when omitted). */
export function agencyOverviewHandlers(deps: AgencyOverviewRouteDeps = {}) {
  const resolved: ResolvedDeps = {
    authenticate: deps.authenticate ?? getUserFromRequest,
    store: deps.store ?? neonAgencyOverviewStore,
    now: deps.now ?? (() => new Date()),
  };
  return {
    GET: ({ request }: { request: Request }) => get(resolved, { request }),
  };
}

export const Route = createFileRoute("/api/agency-overview")({
  server: { handlers: agencyOverviewHandlers() },
});
