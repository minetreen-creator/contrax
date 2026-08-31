/**
 * POST /api/admin/jarvis/owner-mode — OWNER steers the scheduled worker (Phase 6
 * OWNER CONTROLS): set availability (available / away / do_not_disturb) and/or
 * the kill switch (on/off) on the single-row `owner_status` table.
 *
 * THE OWNER ACTING: admin-only (401 unauthenticated, 403 non-admin).
 *
 * Body: { "availability"?: "available"|"away"|"do_not_disturb", "killSwitch"?: boolean }
 * Both fields optional — only provided fields are changed.
 *
 * Persists via brain.setOwnerMode (worker's getOwnerMode + a targeted UPDATE on
 * owner_status, migrations 023 + 025). Returns the new mode. The worker-run
 * consequence is deterministic (resolveWorkerPolicy): kill_switch on, or
 * away/dnd, refuses all scheduled work (logged, no side effects).
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { setOwnerMode } from "~/lib/jarvis/brain";
import { resolveWorkerPolicy } from "~/lib/jarvis/worker";

const AVAIL = ["available", "away", "do_not_disturb"] as const;

async function handler({ request }: { request: Request }) {
  let user;
  try {
    user = await getUserFromRequest(request);
  } catch {
    user = null;
  }
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    availability?: unknown;
    killSwitch?: unknown;
  };
  const wantedAvailability = body.availability as string | undefined;
  if (wantedAvailability !== undefined && !(AVAIL as readonly string[]).includes(wantedAvailability)) {
    return Response.json({ error: "availability must be available | away | do_not_disturb" }, { status: 400 });
  }
  const killSwitch = body.killSwitch === undefined ? undefined : Boolean(body.killSwitch);

  try {
    const db = sql();
    const mode = await setOwnerMode(db, {
      availability: wantedAvailability as typeof AVAIL[number] | undefined,
      killSwitch,
    });
    const policy = resolveWorkerPolicy(mode);
    console.log(
      `[api/admin/jarvis/owner-mode] owner ${user.id} set mode`,
      JSON.stringify({ availability: mode.availability, kill_switch: mode.killSwitch, by: user.email }),
    );
    return Response.json({
      ok: true,
      availability: mode.availability,
      killSwitch: mode.killSwitch,
      consequence: policy.run ? "running" : `refused (${policy.refusedReason})`,
    });
  } catch (err) {
    console.error("[api/admin/jarvis/owner-mode] error:", err);
    return Response.json({ error: "Could not update owner mode." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/jarvis/owner-mode")({
  server: { handlers: { POST: handler } },
});
