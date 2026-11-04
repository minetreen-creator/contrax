import { createFileRoute } from "@tanstack/react-router";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { validateStory } from "~/lib/success-stories";
import { insertStory } from "~/lib/success-stories.server";

/**
 * POST /api/success-stories — the /share-your-story form (owner 2026-11-04).
 * Stores the story as pending and pings the owner's phone; nothing is public
 * until the owner approves it on /admin/stories. Rate-limited per IP and email.
 */
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Honeypot: real people never fill this hidden field.
    if (typeof body.website === "string" && body.website.trim()) return Response.json({ ok: true });
    const v = validateStory(body);
    if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
    const ip = await checkIpLimit(request, "success_story_ip", 5, 60 * 60);
    if (!ip.allowed) return rateLimitedResponse(ip);
    const acct = await checkEmailLimit(v.value.email, "success_story_email", 3, 24 * 60 * 60);
    if (!acct.allowed) return rateLimitedResponse(acct);
    const id = await insertStory(v.value);
    try {
      const { alertOwner } = await import("~/lib/live-push.server");
      await alertOwner({
        title: "⭐ New success story",
        body: `${v.value.name} (${v.value.trade}${v.value.state ? `, ${v.value.state}` : ""}) shared a story. Review it before it goes public.`,
        tag: `story-${id}`,
        url: "/admin/stories",
      });
    } catch (e) {
      console.error("[api/success-stories] owner push failed:", (e as Error).message);
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/success-stories] error:", err);
    return Response.json({ error: "Something went wrong. Please email contrax.companyllc@gmail.com." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/success-stories")({ server: { handlers: { POST: handler } } });
