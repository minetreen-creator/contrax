import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { backfillVisitorIdentity, linkVisitorConversion } from "~/lib/identity-backfill";
import { hashPassword } from "~/lib/password";
import { isBlockedIp } from "~/lib/request-ip";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";
import { isBot, ensureFunnelEventsTable } from "~/lib/tracking-intake";
import { deriveDedupeKey, isValidAttemptId, resolveDedupeSecret } from "~/lib/signup-telemetry";

const SESSION_TTL_DAYS = 30;
// Account-creation floods are blocked per-IP and per-email BEFORE any insert.
// Fail-open; both caps run on every POST so a registration bot burns quota fast.
const SIGNUP_IP_LIMIT = 10; // creations per IP per hour
const SIGNUP_IP_WINDOW = 60 * 60;
const SIGNUP_EMAIL_LIMIT = 5; // creations per email per hour
const SIGNUP_EMAIL_WINDOW = 60 * 60;

/**
 * Ties a visitor's entire pre-signup anonymous journey (funnel_events AND
 * page_views) to the newly created account, scoped to the exact triggering
 * visitor_id. Delegates to the shared helper (src/lib/identity-backfill.ts) so
 * signup / login / OAuth all backfill on both analytics tables consistently.
 *
 * FAIL-OPEN: this is genuinely best-effort. It runs AFTER the user + session
 * are created and must be called inside a try/catch (see the signup handler) so
 * a failure here can never flip a successful signup into an HTTP 500.
 */
async function backfillFunnelIdentity(userId: number, userEmail: string, visitorId: string) {
  await backfillVisitorIdentity(sql, userId, userEmail, visitorId);
}

/**
 * Server-side submit-failure diagnostics (owner 09-12 instrumentation).
 *
 * Fires `signup_submit_error` on every non-2xx signup path so a submit that
 * fails on the server becomes VISIBLE in the funnel_events table. Today the
 * only failure signal is client-side validation — server rejections (email
 * taken, server error) produce nothing, so "22 submits vs 21 successes" leaves
 * exactly 1 invisible failure with no way to tell a dup-email from a 500.
 *
 * PII SAFETY: `label` carries the reason code ONLY — one of
 * "email_taken" | "invalid_input" | "server_error". The submitted email,
 * password, company, and any other form value are NEVER recorded anywhere.
 *
 * Mechanism: the same server-side funnel-event pattern the repo already uses
 * (direct funnel_events INSERT, e.g. bid-alerts alert_created / radar-lead-
 * alerts radar_alert_sent) — NOT a self-fetch to /api/track-visitor, so this
 * event never touches the visitors-summary upsert, the signup-state machine
 * (SIGNUP_STARTED_EVENTS / SIGNUP_VIEWED_EVENTS), lead scoring, or any admin
 * board: none of them key on this event name (verified: tracking-intake
 * signup derivation, radar-conversion-funnel, unified-funnel, journeys,
 * visitor-intel, analytics-consistency all read explicit event-name sets).
 * It is additionally invisible to the 1s intake dedupe / attribution — an
 * honest raw diagnostic row per failed submit (a DOUBLE-fire of the SAME
 * attempt is still collapsed atomically via funnel_events.dedupe_key, owner
 * 09-12 gate a: the server validates attempt_id and derives the key itself).
 *
 * Never throws, never blocks the signup response (own try/catch; single
 * INSERT).
 */
async function recordSignupSubmitError(
  request: Request,
  reason: "email_taken" | "invalid_input" | "server_error",
  visitorId: string | null,
  attemptId: string | null,
): Promise<void> {
  try {
    // Mirror the intake bot filter: crawlers/scripts must not pollute the
    // diagnostic rows (the UA is stored for analysts either way).
    const ua = (request.headers.get("user-agent") ?? "").slice(0, 512) || null;
    if (ua && isBot(ua)) return;
    // Server-side idempotency (owner gates a–d): key derived from the SERVER
    // secret + visitor + event + the client's UUIDv4 attempt id — never the
    // raw browser value. Malformed/missing id → dedupe_key NULL → the event
    // still records (fail-open).
    let dedupeKey: string | null = null;
    if (visitorId && isValidAttemptId(attemptId)) {
      dedupeKey = await deriveDedupeKey(resolveDedupeSecret(), visitorId, "signup_submit_error", attemptId);
    }
    await ensureFunnelEventsTable();
    await sql()`
      INSERT INTO funnel_events (event_name, label, path, user_agent, visitor_id, dedupe_key)
      VALUES ('signup_submit_error', ${reason}, '/api/signup', ${ua}, ${visitorId}, ${dedupeKey})
      ON CONFLICT (dedupe_key) DO NOTHING
    `;
  } catch (err) {
    console.error("[api/signup] signup_submit_error tracking failed (non-fatal):", (err as Error).message);
  }
}

async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP from account creation. Exact-match only; generic
  // 403 that does not reveal why. Runs before parsing the body / any DB write.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // visitorId is hoisted so the error-path diagnostics below can attach the
  // persistent per-visitor id even when the body failed to parse (→ null).
  let visitorId: string | null = null;
  // attemptId (client-minted UUIDv4 per submit attempt) is hoisted for the same
  // reason: the error-path diagnostics derive the idempotency key from it when
  // the body parsed; on a malformed body it stays null → dedupe_key NULL (the
  // diagnostic still records, fail-open).
  let attemptId: string | null = null;
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      confirmPassword?: string;
      plan?: string;
      visitor_id?: string;
      company?: string;
      attempt_id?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const confirmPassword = body.confirmPassword || "";
    // Optional company name, trimmed, capped at 120 chars; empty → NULL (kept
    // nullable on the account. Never required — adds zero signup friction).
    const company = (body.company || "").trim().slice(0, 120) || null;
    // Persistent per-visitor id (contrax_vid) rides in the body so the identity
    // backfill can tie this visitor's ENTIRE anonymous funnel to the new account.
    visitorId = (body.visitor_id || "").trim().slice(0, 64) || null;
    if (typeof body.attempt_id === "string") {
      attemptId = body.attempt_id.trim().slice(0, 64) || null;
    }
    // No-bifurcation rule: the standard /signup flow provisions every NON-PAYING
    // signup on the free Basic Package. A cold signup (no explicit paid plan)
    // defaults to plan_tier='basic'; only a user who explicitly opted into a
    // paid plan on the pricing page / signup selector (starter/professional/
    // agency) gets that plan_tier. The single form, single DB flow stays intact.
    // The submitted `plan` is intentionally not applied here: every signup lands
    // on free Basic (plan_tier='basic', trial_started_at=NULL) and the 14-day
    // Professional trial starts lazily on the user's first premium use.

    // ── Rate limiting (before any insert). IP + account caps; fail-open.
    const ipLimit = await checkIpLimit(request, "signup_ip", SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(email, "signup_email", SIGNUP_EMAIL_LIMIT, SIGNUP_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

    // Validation
    const errors: string[] = [];
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Please enter a valid email address.");
    }
    if (!password || password.length < 8) {
      errors.push("Password must be at least 8 characters.");
    }
    if (password !== confirmPassword) {
      errors.push("Passwords do not match.");
    }
    if (errors.length > 0) {
      await recordSignupSubmitError(request, "invalid_input", visitorId, attemptId);
      return Response.json({ error: errors.join(" ") }, { status: 400 });
    }

    // Check for duplicate
    const existing = await sql()`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      await recordSignupSubmitError(request, "email_taken", visitorId, attemptId);
      return Response.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    // Create user. Paid plans enter a 14-day trial (trial_started_at = now) and
    // expire into a subscribe prompt; the free Basic package never enters a
    // trial (trial_started_at = NULL), so it stays free forever and is never
    // locked by TrialGate.
    const passwordHash = await hashPassword(password);
    // LAZY TRIAL START (owner): every signup provisions on free Basic — no plan
    // tier is granted and trial_started_at stays NULL, so no user is "in trial"
    // at signup and the 14-day PROFESSIONAL trial clock is NOT running. The
    // trial begins (and trial_started_at is set) on the user's FIRST premium
    // action via ensureTrialStarted (src/lib/trial.ts). No credit card.
    const inserted = await sql()`
      INSERT INTO users (email, password_hash, plan_tier, trial_started_at, company_name)
      VALUES (${email}, ${passwordHash}, 'basic', NULL, ${company})
      RETURNING id, email, created_at
    `;
    const user = inserted[0] as { id: number; email: string; created_at: Date };

    // Create session
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await sql()`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
    `;

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    // ── Identity backfill (fail-open, MUST NOT affect the response) ─────────
    // Once the user is known, tie their ENTIRE pre-signup anonymous funnel journey
    // (radar_scan → signup_view → signup_success) to this account, scoped to the
    // exact triggering visitor. Uses the fast idx_funnel_events_vid index on
    // visitor_id. Never blocks signup/redirect — any failure is logged and the
    // user proceeds normally (their post-login tracking still carries identity).
    //
    // Also links the per-visitor SUMMARY row (`visitors` table) to the new
    // account (converted_user_id + converted_at, signup → 'Success') so the
    // anonymous→user conversion survives in the summary cache too — creating the
    // row when it doesn't exist yet, so no conversion is ever lost.
    //
    // ROOT CAUSE of a past bug: this backfill (schema-guard DDL + a funnel
    // UPDATE) runs AFTER the account and session are already created. An
    // un-wrapped throw here flipped an otherwise-successful signup into a
    // spurious HTTP 500 (client saw "Something went wrong." even though the
    // account+session were created and authenticated). It is intentionally
    // FAIL-OPEN: the whole step sits inside its own try/catch so no failure in
    // it can propagate. Keep it isolated — a successful signup must always
    // return the success response below, regardless of what the backfill does.
    if (visitorId) {
      try {
        await backfillFunnelIdentity(user.id, user.email, visitorId);
        // NEW (Admin Tracker Enrichment): summary-row conversion, idempotent.
        await linkVisitorConversion(sql, user.id, visitorId);
      } catch (backfillErr) {
        // Identity backfill is best-effort — a failure must never fail signup.
        console.error("[api/signup] identity backfill failed (non-fatal):", backfillErr);
      }
    }

    return Response.json({
      success: true,
      user: { id: user.id, email: user.email, created_at: String(user.created_at) },
    });
  } catch (err) {
    console.error("[api/signup] error:", err);
    await recordSignupSubmitError(request, "server_error", visitorId, attemptId);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/signup")({
  server: { handlers: { POST: handler } },
});
