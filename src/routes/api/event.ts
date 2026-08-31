import { createFileRoute } from "@tanstack/react-router";
import { handleIntake } from "~/lib/tracking-intake";

/**
 * POST /api/event — LEGACY ALIAS (kept for backward compatibility).
 *
 * Every visitor beacon now converges on /api/track-visitor (see
 * src/lib/tracking-intake.ts); this route stays as a thin 1:1 forwarder to the
 * shared handler so old embeds / static-page beacons that still POST here keep
 * working, with the exact same response shapes as before (200 on success,
 * `{ ok:true, bot:true }` for bots, `{ ok:true, skipped:true }` for a missing
 * event name, `{ ok:true, deduped:true }` for the 1s collapse, 500 on a lost
 * detail row after the DDL-guard retry).
 *
 * NOTE: keep this module free of node builtins — only global fetch + neon.
 */

async function handler({ request }: { request: Request }) {
  return handleIntake(request, "event");
}

export const Route = createFileRoute("/api/event")({
  server: { handlers: { POST: handler } },
});