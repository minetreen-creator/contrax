import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { attentionItems, cleanNote, operations, tiles } from "~/lib/command-center";
import { addNote, commandCounts, doneNote, listNotes } from "~/lib/command-center.server";

/**
 * GET  /api/admin/command → the Command Center (counts, attention list, operations, notes)
 * POST /api/admin/command → { action: "note", body } | { action: "done", id }
 * Admin only (owner 2026-11-05).
 */
async function guard(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { error: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!user.is_admin) return { error: Response.json({ error: "Admin access required" }, { status: 403 }) };
  return { user };
}

async function get({ request }: { request: Request }) {
  const g = await guard(request);
  if (g.error) return g.error;
  try {
    const now = new Date();
    const counts = await commandCounts();
    const ops = operations(counts, now);
    let notes: Awaited<ReturnType<typeof listNotes>> = [];
    try {
      notes = await listNotes();
    } catch {
      notes = [];
    }
    return Response.json(
      { now: now.toISOString(), counts, attention: attentionItems(counts), operations: ops, tiles: tiles(ops), notes },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[api/admin/command] read failed:", err);
    return Response.json({ error: "Could not load the Command Center" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const g = await guard(request);
  if (g.error) return g.error;
  const body = (await request.json().catch(() => ({}))) as { action?: string; body?: unknown; id?: unknown };
  try {
    if (body.action === "note") {
      const note = cleanNote(body.body);
      if (!note) return Response.json({ error: "Write a note first (up to 500 characters)." }, { status: 400 });
      await addNote(note);
      return Response.json({ ok: true });
    }
    if (body.action === "done") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown note." }, { status: 400 });
      await doneNote(id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("[api/admin/command] write failed:", err);
    return Response.json({ error: "Could not save that" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/command")({ server: { handlers: { GET: get, POST: post } } });
