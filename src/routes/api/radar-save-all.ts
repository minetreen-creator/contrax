import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { hasUnlimitedSaves, loadUserTrialStatus, FREE_SAVE_LIMIT } from "~/lib/trial";

/**
 * /api/radar-save-all — save a set of radar matches to the logged-in user's
 * pipeline in one call (the "save all" action on the Radar-login notification).
 *
 * FN/F-4: the anonymous radar session (the bid ids the visitor saw) lives in the
 * browser's localStorage — NO email is collected or stored here. The client
 * sends only the integer bid ids it saw; this endpoint validates them against
 * the live `bids` table and persists them as saved_matches.
 *
 * Plan-tier save limit is RESPECTED (same boundary as /api/bids-save): a Basic
 * (free) user may keep at most FREE_SAVE_LIMIT saved bids, so we save up to
 * that cap (skipping ones already saved); Starter+ / admins / demo / active
 * grants save all. The response reports exactly what was saved so the UI can be
 * truthful ("saved X of N") and route a capped user to upgrade.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { bidIds?: unknown } | null;
    const raw = Array.isArray(body?.bidIds) ? (body.bidIds as unknown[]) : [];
    // Validate strictly: positive integers only, deduped.
    const ids = [...new Set(raw.filter((x) => Number.isInteger(x) && Number(x) > 0).map((x) => Number(x)))];
    if (ids.length === 0) {
      return Response.json({ error: "No valid bid ids" }, { status: 400 });
    }

    const trial = await loadUserTrialStatus(user.id);
    const limited = !hasUnlimitedSaves(trial, user);

    // Only save bids that actually exist (saved_matches has an FK to bids(id),
    // and we must never fabricate pipeline rows from arbitrary ids).
    const existingRows = await sql()`SELECT id FROM bids WHERE id = ANY(${ids})`;
    const existingSet = new Set((existingRows as any[]).map((r) => Number(r.id)));
    const validIds = ids.filter((id) => existingSet.has(id));
    if (validIds.length === 0) {
      return Response.json({ saved: 0, total: ids.length, limited, limit: limited ? FREE_SAVE_LIMIT : null });
    }

    let toSave: number[];
    if (!limited) {
      toSave = validIds;
    } else {
      const savedRows = await sql()`SELECT bid_id FROM saved_matches WHERE user_id = ${user.id} AND status = 'saved'`;
      const savedSet = new Set((savedRows as any[]).map((r) => Number(r.bid_id)));
      const notSaved = validIds.filter((id) => !savedSet.has(id));
      const slots = Math.max(0, FREE_SAVE_LIMIT - savedSet.size);
      toSave = notSaved.slice(0, slots);
    }

    for (const id of toSave) {
      await sql()`INSERT INTO saved_matches (user_id, bid_id, status) VALUES (${user.id}, ${id}, 'saved') ON CONFLICT (user_id, bid_id) DO UPDATE SET status = 'saved'`;
    }

    return Response.json({
      saved: toSave.length,
      total: validIds.length,
      limited,
      limit: limited ? FREE_SAVE_LIMIT : null,
    });
  } catch (err) {
    console.error("[api/radar-save-all] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save radar matches" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/radar-save-all")({
  server: { handlers: { POST: handler } },
});
