import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { sendPasswordResetEmail } from "~/lib/email";
import { issuePasswordResetToken, RESET_TOKEN_TTL_MS } from "~/lib/password-reset-tokens";
import { isBlockedIp } from "~/lib/request-ip";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";

// Prevent password-reset email flooding / token-issuing spam. Fail-open;
// caps run before any token is issued. The 429 message stays generic so we
// never reveal whether the email is registered.
const FORGOT_IP_LIMIT = 10; // requests per IP per 15 min
const FORGOT_IP_WINDOW = 15 * 60;
const FORGOT_EMAIL_LIMIT = 5; // requests per email per 15 min
const FORGOT_EMAIL_WINDOW = 15 * 60;


async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP from requesting a password reset. Exact-match
  // only; generic 403 that does not reveal why. Runs before any token issuing.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { email?: string };
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Rate limit before issuing a token (fail-open; sees the validated email).
    const ipLimit = await checkIpLimit(request, "forgot_ip", FORGOT_IP_LIMIT, FORGOT_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(email, "forgot_email", FORGOT_EMAIL_LIMIT, FORGOT_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);
    const user = await sql()`SELECT id FROM users WHERE email = ${email}`;

    let token: string | undefined;
    if (user.length > 0) {
      token = await issuePasswordResetToken(email, RESET_TOKEN_TTL_MS);

      if (process.env.RESEND_API_KEY) {
        // Email delivery configured — send the reset link (never throws).
        await sendPasswordResetEmail(email, token);
      }
    }

    // Always return success — never reveal whether the email is registered.
    return Response.json({
      success: true,
      // When email delivery isn't configured, hand the token back so the UI
      // can display the reset link directly.
      token: process.env.RESEND_API_KEY ? undefined : token,
      message: "If an account exists for that email, a password reset link has been sent.",
    });
  } catch (err) {
    console.error("[api/forgot-password] error:", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/forgot-password")({
  server: { handlers: { POST: handler } },
});
