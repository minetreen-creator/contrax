/**
 * GET /api/nonprofit/status — the signed-in applicant's OWN Nonprofit Free state.
 *
 * Scoping is structural: the read is `WHERE user_id = <session user>`, so there is no id
 * parameter a caller could tamper with and no path to another account's row.
 *
 * WHAT IS DELIBERATELY ABSENT: the EIN (the owner's rule is that an EIN is never
 * displayed, explicitly including the applicant status page — build plan §6), the matched
 * IRS name, the reason class, the decision reason and any revocation data. The applicant
 * is told their own state and the copy that goes with it, and nothing that would leak
 * another organization's information or an accusatory classification.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  getNonprofitApplicationStatus,
  type NonprofitApplicationStatusRow,
} from "~/lib/nonprofit-apply.server";
import {
  NONPROFIT_APPLY_REVIEW_WINDOW,
  NONPROFIT_PENDING_LIMITS_COPY,
  NONPROFIT_PROMISE,
  NONPROFIT_STATUS_APPLY_LINK_LABEL,
  nonprofitVerificationBadge,
  statusCopyFor,
} from "~/lib/nonprofit-copy";
import { nonprofitSearchPolicy, evaluateNonprofitEntitlement } from "~/lib/nonprofit.server";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The public shape of the caller's own application — no EIN, no engine internals. */
function publicApplication(row: NonprofitApplicationStatusRow) {
  const copy = statusCopyFor(row.status);
  const entitlement = evaluateNonprofitEntitlement({
    user_id: null,
    status: row.status,
    verification_method: row.verification_method,
    bmf_subsection: null,
    bmf_posting_date: row.bmf_posting_date,
    granted_at: row.granted_at,
    reverify_due_at: row.reverify_due_at,
  });
  const policy = nonprofitSearchPolicy(entitlement);
  return {
    orgName: row.org_name,
    state: row.state,
    contactName: row.contact_name,
    contactRole: row.contact_role,
    status: row.status,
    statusLabel: copy?.label ?? null,
    statusDetail: copy?.detail ?? null,
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    grantedAt: row.granted_at,
    reverifyDueAt: row.reverify_due_at,
    verificationMethod: row.verification_method,
    supportingDocsRequested: row.supporting_docs_requested,
    // The owner's wording, from the mirror's posting date; null renders nothing.
    verificationWording: nonprofitVerificationBadge({
      verified: entitlement.verified,
      irsRecordsAsOf: row.bmf_posting_date,
    }),
    irsRecordsAsOf: entitlement.irsRecordsAsOf,
    tier: policy.tier,
    reviewWindow: NONPROFIT_APPLY_REVIEW_WINDOW,
    pendingLimits: policy.tier === "nonprofit_pending" ? NONPROFIT_PENDING_LIMITS_COPY : null,
  };
}

async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return json(
      {
        ok: false,
        authenticated: false,
        error: "Sign in to see your Nonprofit Free status.",
      },
      401,
    );
  }
  const row = await getNonprofitApplicationStatus(user.id);
  return json({
    ok: true,
    authenticated: true,
    promise: NONPROFIT_PROMISE,
    applyLinkLabel: NONPROFIT_STATUS_APPLY_LINK_LABEL,
    application: row ? publicApplication(row) : null,
  });
}

export const Route = createFileRoute("/api/nonprofit/status")({
  server: { handlers: { GET: handler } },
});
