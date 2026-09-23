import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  NONPROFIT_QUEUE_FILTERS,
  getNonprofitReviewApplication,
  isNonprofitQueueFilter,
  listNonprofitApplications,
} from "~/lib/nonprofit-review.server";

/**
 * GET /api/admin/nonprofit-applications           → the review queue (default view)
 * GET /api/admin/nonprofit-applications?filter=…  → queue | denied_revoked | approved | all
 * GET /api/admin/nonprofit-applications?id=123    → one application + its audit history
 *
 * ADMIN-GATED, exactly like /api/admin/users (owner lock: Option A — `is_admin` OR the
 * ADMIN_EMAILS allowlist, resolved in ~/lib/api-auth). 401 unauthenticated, 403
 * non-admin: the queue is the only place an EIN conflict, an IRS match or a reviewer note
 * is visible, so it sits behind the same gate as every other admin read.
 *
 * The list read returns the reviewer's queue projection and NOTHING ELSE — no EIN (owner
 * rule: never displayed, and this projection never selects it), no stored evidence blob.
 * The conflict claimant behind a contested EIN (`evidence.ein_claim`) appears only in the
 * per-application detail this route serves to an authenticated administrator.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");
    if (idParam !== null && idParam !== "") {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ error: "A numeric application id is required." }, { status: 400 });
      }
      const application = await getNonprofitReviewApplication(id);
      if (!application) return Response.json({ error: "Application not found" }, { status: 404 });
      return Response.json({ application });
    }

    const filterParam = url.searchParams.get("filter") ?? "queue";
    if (!isNonprofitQueueFilter(filterParam)) {
      return Response.json(
        { error: `filter must be one of ${NONPROFIT_QUEUE_FILTERS.join(", ")}` },
        { status: 400 },
      );
    }
    const limitParam = url.searchParams.get("limit");
    const applications = await listNonprofitApplications(filterParam, {
      limit: limitParam ? Number(limitParam) : undefined,
    });
    return Response.json({ filter: filterParam, applications, count: applications.length });
  } catch (err) {
    console.error("[api/admin/nonprofit-applications] error:", err);
    return Response.json({ error: "Failed to load the review queue" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/nonprofit-applications")({
  server: { handlers: { GET: handler } },
});
