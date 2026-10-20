/**
 * GET/POST /api/workspaces — the client-workspace endpoint (Agency tier phase 1,
 * owner decision 2026-10-20).
 *
 * GET  → { data: WorkspaceRow[], activeWorkspaceId, canCreate, limit }
 * POST → { action: "create", name, states?, trades? }
 *        { action: "rename", id, name }
 *        { action: "settings", id, states, trades }
 *        { action: "switch", id | null }      (null = back to the account context)
 *
 * THE POLICY IS NOT RE-IMPLEMENTED HERE. Entitlement + the cap come from
 * src/lib/workspaces.ts (`computeWorkspaceAccess` / `canAddWorkspace`), the atomic
 * cap is enforced inside the database by `workspace_create` (migration 068), and
 * every read/write is owner-scoped in src/lib/workspaces.server.ts. This file only
 * authenticates, validates input and maps outcomes to status codes.
 *
 * READ vs EDIT (the CRM's downgrade policy, applied here):
 *   * GET is NEVER gated — a downgraded account keeps reading its workspaces.
 *   * create / rename / settings are EDITS and need Agency entitlement (403 below).
 *   * switch is NOT an edit: it only changes which client context the account is
 *     viewing, so a downgraded account can still page through the clients (and
 *     their saved bids/contacts) it already has. It is still owner-scoped: a
 *     workspace id that is not the caller's is a 404, never a silent no-op.
 *
 * The `deps` seam exists for the same reason as crmRouteHandlers()'s: a unit test
 * drives the REAL handlers with an in-memory store and no database, instead of
 * `mock.module` (bun's mock registry is process-global and leaks across test files).
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { neonCrmAccessDeps } from "~/lib/crm-access.server";
import { loadUserTrialStatus } from "~/lib/trial";
import {
  validateWorkspaceName,
  validateWorkspaceStates,
  validateWorkspaceTrades,
  type WorkspaceAccess,
} from "~/lib/workspaces";
import {
  computeWorkspaceAccess,
  neonWorkspaceStore,
  type WorkspaceStore,
} from "~/lib/workspaces.server";

/** The authenticated caller, as much of it as this endpoint needs. */
export type WorkspaceRouteUser = { id: number; is_admin?: boolean };

export interface WorkspaceRouteDeps {
  authenticate?: (request: Request) => Promise<WorkspaceRouteUser | null>;
  /** Entitlement is src/lib/workspaces.ts ONLY — never re-implemented here. */
  getAccess?: (user: WorkspaceRouteUser) => Promise<WorkspaceAccess>;
  store?: WorkspaceStore;
}

interface ResolvedDeps {
  authenticate: (request: Request) => Promise<WorkspaceRouteUser | null>;
  getAccess: (user: WorkspaceRouteUser) => Promise<WorkspaceAccess>;
  store: WorkspaceStore;
}

/** The real entitlement read: the shipped trial row + subscription status. */
async function defaultAccess(user: WorkspaceRouteUser): Promise<WorkspaceAccess> {
  const [trial, subscriptionStatus] = await Promise.all([
    loadUserTrialStatus(user.id),
    neonCrmAccessDeps.loadSubscriptionStatus(user.id),
  ]);
  return computeWorkspaceAccess(trial, subscriptionStatus, user);
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

const AGENCY_REQUIRED = {
  error: "agency_plan_required",
  message: "Creating and editing client workspaces is an Agency plan feature.",
} as const;

async function get(deps: ResolvedDeps, { request }: { request: Request }) {
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const access = await deps.getAccess(user);
    const [data, activeWorkspaceId] = await Promise.all([
      deps.store.list(user.id),
      deps.store.getActiveWorkspaceId(user.id),
    ]);
    return Response.json({
      data,
      activeWorkspaceId,
      canCreate: access.canCreate,
      limit: access.limit,
    });
  } catch (error) {
    console.error("[api/workspaces] read failed", error);
    return Response.json({ error: "Could not load workspaces" }, { status: 500 });
  }
}

async function post(deps: ResolvedDeps, { request }: { request: Request }) {
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const access = await deps.getAccess(user);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "create") {
      if (!access.canCreate) return Response.json(AGENCY_REQUIRED, { status: 403 });
      const name = validateWorkspaceName(body.name);
      if (name === null) {
        return Response.json(
          { error: "invalid_name", message: "Enter a client name of 1–80 characters." },
          { status: 400 },
        );
      }
      // Omitted lists mean "no states / no trades yet" — an explicit empty value, not
      // a guess. A PRESENT but malformed list is a 400: silently dropping states would
      // look like the workspace simply does not cover them.
      const states = body.states === undefined ? [] : validateWorkspaceStates(body.states);
      const trades = body.trades === undefined ? [] : validateWorkspaceTrades(body.trades);
      if (states === null) {
        return Response.json(
          { error: "invalid_states", message: "States must be two-letter codes." },
          { status: 400 },
        );
      }
      if (trades === null) {
        return Response.json(
          { error: "invalid_trades", message: "Trades must be short text labels." },
          { status: 400 },
        );
      }
      const id = await deps.store.create(user.id, access.limit, { name, states, trades });
      if (id === null) {
        return Response.json(
          {
            error: "workspace_limit",
            message: `Your plan allows ${access.limit} client workspaces.`,
          },
          { status: 409 },
        );
      }
      return Response.json({ id }, { status: 201 });
    }

    if (action === "rename") {
      if (!access.canCreate) return Response.json(AGENCY_REQUIRED, { status: 403 });
      const id = positiveInt(body.id);
      const name = validateWorkspaceName(body.name);
      if (id === null) return Response.json({ error: "Invalid workspace id" }, { status: 400 });
      if (name === null) {
        return Response.json(
          { error: "invalid_name", message: "Enter a client name of 1–80 characters." },
          { status: 400 },
        );
      }
      const renamed = await deps.store.rename(user.id, id, name);
      if (renamed === null) return Response.json({ error: "Workspace not found" }, { status: 404 });
      return Response.json({ id: renamed });
    }

    if (action === "settings") {
      if (!access.canCreate) return Response.json(AGENCY_REQUIRED, { status: 403 });
      const id = positiveInt(body.id);
      if (id === null) return Response.json({ error: "Invalid workspace id" }, { status: 400 });
      const states = body.states === undefined ? [] : validateWorkspaceStates(body.states);
      const trades = body.trades === undefined ? [] : validateWorkspaceTrades(body.trades);
      if (states === null || trades === null) {
        return Response.json(
          {
            error: "invalid_settings",
            message: "States must be two-letter codes and trades short text labels.",
          },
          { status: 400 },
        );
      }
      const updated = await deps.store.updateSettings(user.id, id, states, trades);
      if (updated === null) return Response.json({ error: "Workspace not found" }, { status: 404 });
      return Response.json({ id: updated });
    }

    if (action === "switch") {
      // `id: null` returns the account to its own (unscoped) context.
      const id = body.id === null ? null : positiveInt(body.id);
      if (id === null && body.id !== null) {
        return Response.json({ error: "Invalid workspace id" }, { status: 400 });
      }
      const ok = await deps.store.setActive(user.id, id);
      if (!ok) return Response.json({ error: "Workspace not found" }, { status: 404 });
      return Response.json({ success: true, activeWorkspaceId: id });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[api/workspaces] write failed", error);
    return Response.json({ error: "Could not save workspace" }, { status: 500 });
  }
}

/** Builds the endpoint's handlers around `deps` (production defaults when omitted). */
export function workspaceRouteHandlers(deps: WorkspaceRouteDeps = {}) {
  const resolved: ResolvedDeps = {
    authenticate: deps.authenticate ?? getUserFromRequest,
    getAccess: deps.getAccess ?? defaultAccess,
    store: deps.store ?? neonWorkspaceStore,
  };
  return {
    GET: ({ request }: { request: Request }) => get(resolved, { request }),
    POST: ({ request }: { request: Request }) => post(resolved, { request }),
  };
}

export const Route = createFileRoute("/api/workspaces")({
  server: { handlers: workspaceRouteHandlers() },
});
