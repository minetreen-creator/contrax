import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { STORIES_TO_PUBLISH } from "~/lib/success-stories";
import { listStoriesForAdmin, setStoryStatus } from "~/lib/success-stories.server";

/**
 * GET  /api/admin/success-stories → every submitted story + how many are public
 * POST /api/admin/success-stories → { action: "approve" | "reject" | "pending", id }
 * Admin only (owner 2026-11-04).
 */
async function guard(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return null;
}

async function get({ request }: { request: Request }) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const stories = await listStoriesForAdmin();
    const published = stories.filter((s) => s.status === "approved" && s.share !== "private").length;
    return Response.json({ stories, published, needed: STORIES_TO_PUBLISH });
  } catch (err) {
    console.error("[api/admin/success-stories] list error:", err);
    return Response.json({ error: "Failed to load stories" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string; id?: number };
    const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : body.action === "pending" ? "pending" : null;
    const id = Number(body.id);
    if (!status || !Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown action." }, { status: 400 });
    if (!(await setStoryStatus(id, status))) return Response.json({ error: "Story not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/success-stories] update error:", err);
    return Response.json({ error: "Failed to update the story" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/success-stories")({ server: { handlers: { GET: get, POST: post } } });
