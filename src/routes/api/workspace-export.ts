/**
 * GET /api/workspace-export?workspace=<id> — the PER-CLIENT CSV download (Agency
 * tier phase 3, owner decision 2026-10-20).
 *
 *   • No session            → 401 { error: "Not authenticated" } (store untouched)
 *   • ?workspace missing or not a positive integer
 *                           → 400 { error: "Invalid workspace id" }
 *   • a workspace id the caller does NOT own
 *                           → 404 { error: "Workspace not found" } — never data, and
 *                             indistinguishable from an id that does not exist
 *   • otherwise             → 200 text/csv attachment of THAT client's saved bids
 *                             and CRM contacts, filename
 *                             `<workspace-name>-pipeline-YYYY-MM-DD.csv`
 *   • store failure         → 500 — never an empty file that would read as "this
 *                             client has no bids or contacts"
 *
 * THE SCOPING IS NOT RE-IMPLEMENTED HERE. The handler passes the SESSION user id to
 * the store, which pins `w.user_id = <session user>` AND `workspace_id = <target>`
 * on every read (src/lib/workspace-export.server.ts). There is no parameter a
 * request can use to name an owner.
 *
 * READS ARE NOT ENTITLEMENT-GATED (the phase-1/phase-2 rule kept deliberately): an
 * Agency account that downgrades still exports the clients it already has, just as
 * it still reads /api/workspaces. No write path, no cap arithmetic, no new grant.
 *
 * The `deps` seam exists for the CRM/workspaces reason: a unit test drives the REAL
 * handler with an in-memory store and a frozen clock instead of `mock.module`, whose
 * registry is process-global and leaks across test files.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { buildWorkspaceExportCsv, workspaceExportFilename } from "~/lib/workspace-export";
import { neonWorkspaceExportStore, type WorkspaceExportStore } from "~/lib/workspace-export.server";

/** The authenticated caller, as much of it as this endpoint needs. */
export type WorkspaceExportRouteUser = { id: number; is_admin?: boolean };

export interface WorkspaceExportRouteDeps {
  authenticate?: (request: Request) => Promise<WorkspaceExportRouteUser | null>;
  store?: WorkspaceExportStore;
  /** Clock seam: the filename's date stamp must be pinnable in a test. */
  now?: () => Date;
}

interface ResolvedDeps {
  authenticate: (request: Request) => Promise<WorkspaceExportRouteUser | null>;
  store: WorkspaceExportStore;
  now: () => Date;
}

/** A positive integer workspace id from the query string, or null. */
export function parseWorkspaceExportId(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^[0-9]+$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function get(deps: ResolvedDeps, { request }: { request: Request }) {
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = parseWorkspaceExportId(new URL(request.url).searchParams.get("workspace"));
  if (workspaceId === null) {
    return Response.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  try {
    const bundle = await deps.store.load(user.id, workspaceId);
    // Not this account's client (or it does not exist): the same answer either way,
    // and no rows are built, so nothing of another client can leak through the shape
    // of the response.
    if (!bundle) return Response.json({ error: "Workspace not found" }, { status: 404 });
    return new Response(buildWorkspaceExportCsv(bundle), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${workspaceExportFilename(
          bundle.workspace.name,
          deps.now(),
        )}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/workspace-export] export failed", error);
    return Response.json({ error: "Could not export this client" }, { status: 500 });
  }
}

/** Builds the endpoint's handlers around `deps` (production defaults when omitted). */
export function workspaceExportHandlers(deps: WorkspaceExportRouteDeps = {}) {
  const resolved: ResolvedDeps = {
    authenticate: deps.authenticate ?? getUserFromRequest,
    store: deps.store ?? neonWorkspaceExportStore,
    now: deps.now ?? (() => new Date()),
  };
  return {
    GET: ({ request }: { request: Request }) => get(resolved, { request }),
  };
}

export const Route = createFileRoute("/api/workspace-export")({
  server: { handlers: workspaceExportHandlers() },
});
