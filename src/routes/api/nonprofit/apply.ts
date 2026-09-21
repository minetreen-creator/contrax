/**
 * POST /api/nonprofit/apply — the Nonprofit Free application (build plan §1).
 *
 * This route owns ONLY the two request-scoped steps of the owner's order of operations:
 * authentication (401 for an anonymous caller) and rate limiting BEFORE any DB write.
 * Everything after that — field validation, the EIN claim check, the local-mirror
 * verification, the single audited write and the applicant email — lives in
 * src/lib/nonprofit-apply.server.ts, which is what lets the unit suite prove it with no
 * database.
 *
 * NOTHING here touches Stripe, a card, a price or a plan tier: Nonprofit Free is an
 * internal entitlement record.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  sendNonprofitApprovedEmail,
  sendNonprofitDeniedEmail,
} from "~/lib/email";
import {
  applyForNonprofitFree,
  defaultNonprofitApplyDeps,
  type NonprofitApplyDeps,
} from "~/lib/nonprofit-apply.server";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";

/** An application is rare and deliberate: 10/hour per IP, 5/hour per account. */
const APPLY_IP_LIMIT = 10;
const APPLY_IP_WINDOW_SEC = 3600;
const APPLY_ACCOUNT_LIMIT = 5;
const APPLY_ACCOUNT_WINDOW_SEC = 3600;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The applicant emails, wired here so the library module stays mailer-free. */
function notifyDeps(): NonprofitApplyDeps {
  return {
    ...defaultNonprofitApplyDeps,
    notify: async (notification) => {
      if (notification.kind === "approved") {
        await sendNonprofitApprovedEmail(notification.email, {
          orgName: notification.orgName,
          verificationWording: notification.verificationWording,
        });
        return;
      }
      await sendNonprofitDeniedEmail(notification.email, notification.orgName);
    },
  };
}

async function handler({ request }: { request: Request }): Promise<Response> {
  // 1. An account is required — the application is attached to an existing user.
  const user = await getUserFromRequest(request);
  if (!user) {
    return json(
      { ok: false, error: "Sign in to apply for Nonprofit Free access." },
      401,
    );
  }

  // 2. Rate limits BEFORE any database write (the signup.ts order).
  const ipLimit = await checkIpLimit(request, "nonprofit_apply_ip", APPLY_IP_LIMIT, APPLY_IP_WINDOW_SEC);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
  const accountLimit = await checkEmailLimit(
    user.email,
    "nonprofit_apply_account",
    APPLY_ACCOUNT_LIMIT,
    APPLY_ACCOUNT_WINDOW_SEC,
  );
  if (!accountLimit.allowed) return rateLimitedResponse(accountLimit);

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // A body that is not JSON is a field problem, not a server error: step 3 answers 400.
    body = null;
  }

  const result = await applyForNonprofitFree({ userId: user.id, body }, notifyDeps());
  return json(result.body, result.status);
}

export const Route = createFileRoute("/api/nonprofit/apply")({
  server: { handlers: { POST: handler } },
});
