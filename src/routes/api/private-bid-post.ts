import { createFileRoute } from "@tanstack/react-router";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { cleanProjectPost, projectPostNotice } from "~/lib/private-bid-post";

/** POST a project for review: stores it and emails the owner. Nothing is published here (see ~/lib/private-bid-post). */
async function handler({ request }: { request: Request }) {
  try {
    const cleaned = cleanProjectPost(await request.json().catch(() => null), new Date().toISOString().slice(0, 10));
    if (!cleaned.ok) return Response.json({ error: cleaned.error }, { status: 400 });
    const p = cleaned.post;
    const ip = await checkIpLimit(request, "project_post_ip", 5, 60 * 60);
    if (!ip.allowed) return rateLimitedResponse(ip);
    const em = await checkEmailLimit(p.email, "project_post_email", 3, 60 * 60);
    if (!em.allowed) return rateLimitedResponse(em);
    const { sql } = await import("~/db");
    await sql()`CREATE TABLE IF NOT EXISTS private_bid_posts (
      id SERIAL PRIMARY KEY, business TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
      work TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, deadline DATE, details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql()`INSERT INTO private_bid_posts (business, contact_name, email, work, city, state, deadline, details)
      VALUES (${p.business}, ${p.name}, ${p.email}, ${p.work}, ${p.city}, ${p.state}, ${p.deadline || null}, ${p.details})`;
    // The post is saved either way; the email is how the owner hears about it.
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const m = projectPostNotice(p);
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: "Contrax <hello@contrax.company>",
          to: ["contrax.companyllc@gmail.com"],
          replyTo: p.email,
          subject: m.subject,
          text: m.text,
        });
      } catch (err) {
        console.error("[api/private-bid-post] notice failed:", err instanceof Error ? err.message : "error");
      }
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("[api/private-bid-post] error:", error instanceof Error ? error.message : "error");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/private-bid-post")({
  server: { handlers: { POST: handler } },
});
