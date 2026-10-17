import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { expandTrade } from "~/lib/trade-registry";
import { sendLaunchpadStatementEmail } from "~/lib/email";
import { parseStatementRequest, statementEmailHtml, STATEMENT_SUBJECT } from "~/lib/launchpad-email";
import { captureRadarLead, isBotUa } from "~/lib/radar-lead-capture.server";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST /api/launchpad/email-statement (owner 2026-10-17)
 * Body: { profile, alerts?: boolean, visitor_id? }
 *
 * Emails the visitor their own capability statement — only to the business
 * email in the profile — and records who asked (company, trade, state, email)
 * in launchpad_statements so the admin can see Launchpad use. When `alerts` is
 * true (an unchecked-by-default box), the address also joins the weekly
 * match-alert channel through the same confirm-first path Radar uses.
 */
const IP_LIMIT = 5; // per IP per hour
const EMAIL_LIMIT = 3; // per address per day

async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const parsed = parseStatementRequest(await request.json().catch(() => null));
    if (!parsed) {
      return Response.json({ error: "Finish the required statement fields, including a valid business email." }, { status: 400 });
    }
    const { profile, alerts, visitorId } = parsed;

    const ipLimit = await checkIpLimit(request, "launchpad_statement_ip", IP_LIMIT, 60 * 60);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const emailLimit = await checkEmailLimit(profile.email, "launchpad_statement_email", EMAIL_LIMIT, 24 * 60 * 60);
    if (!emailLimit.allowed) return rateLimitedResponse(emailLimit);

    const bot = isBotUa(request.headers.get("user-agent"));
    const sent = bot ? false : await sendLaunchpadStatementEmail(profile.email, STATEMENT_SUBJECT, statementEmailHtml(profile, alerts));

    await sql()`
      CREATE TABLE IF NOT EXISTS launchpad_statements (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        trade TEXT,
        state TEXT,
        alerts_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
        sent BOOLEAN NOT NULL DEFAULT FALSE,
        visitor_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql()`
      INSERT INTO launchpad_statements (email, company, trade, state, alerts_opt_in, sent, visitor_id)
      VALUES (${profile.email}, ${profile.company.slice(0, 200)}, ${profile.trade.slice(0, 120) || null}, ${profile.state || null}, ${alerts}, ${sent}, ${visitorId})
    `;

    let alertStatus: string | null = null;
    if (alerts) {
      const trade = profile.trade.slice(0, 120);
      const e = trade && !/^\d{6}$/.test(trade) ? expandTrade(trade) : null;
      alertStatus = await captureRadarLead({
        email: profile.email,
        visitorId,
        radarProfile: JSON.stringify({
          trade: trade || null,
          state: profile.state || null,
          cert: null,
          sizePref: null,
          expanded: e ? { terms: e.terms.slice(0, 12), naicsCodes: e.naicsCodes } : null,
        }),
        source: "launchpad",
        sendConfirmation: !bot,
      });
    }

    if (!sent) {
      return Response.json({ error: "We couldn't send the email right now. Download or print your statement instead.", alertStatus }, { status: 502 });
    }
    return Response.json({ success: true, alertStatus });
  } catch (error) {
    console.error("[api/launchpad/email-statement] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/launchpad/email-statement")({
  server: { handlers: { POST: handler } },
});
