import { createFileRoute } from "@tanstack/react-router";
import { handleIntake } from "~/lib/tracking-intake";

/**
 * POST /api/track-visitor
 *
 * The ONE canonical visitor-intake beacon (Admin Tracker Enrichment,
 * owner 2026-08-31). All visitor signal — page views, conversion events
 * (hero CTA clicks, score submissions, signup attempts/successes, Radar
 * activity, brief views) — flows through here and is written to the EXISTING
 * `funnel_events` (kind="event") or `page_views` (kind="page") tables, plus a
 * per-visitor SUMMARY row in the new `visitors` table for fast admin display.
 *
 * Body:  { kind?: "event" | "page" (alias: type), event?, label?, path?, referrer?,
 *          visitor_id?, visit_id?, user_id?, user_email? }
 *
 * The kind is read from the body; when absent it defaults to "event" (an
 * event-shaped body also requires a usable `event` name, else the beacon is
 * skipped with `{ ok:true, skipped:true }`).
 *
 * Every safeguard from the former /api/event + /api/page-view endpoints is
 * preserved here (see src/lib/tracking-intake.ts), and the legacy URLs remain
 * as thin forwarders so no old/embed beacon breaks. Never crashes a request —
 * the client is fire-and-forget and ignores the response either way.
 *
 * NOTE: keep this module free of node builtins — the shared handler only uses
 * global fetch + neon, so it stays compatible with the client-bundle protection.
 */

async function handler({ request }: { request: Request }) {
  return handleIntake(request);
}

export const Route = createFileRoute("/api/track-visitor")({
  server: { handlers: { POST: handler } },
});