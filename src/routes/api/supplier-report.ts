import { createFileRoute } from "@tanstack/react-router";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { cleanSupplierRequest, supplierNotice } from "~/lib/supplier-report";

/** POST {email, company, type, state}: stores the request and emails the owner (see ~/lib/supplier-report). */
async function handler({ request }: { request: Request }) {
  try {
    const cleaned = cleanSupplierRequest(await request.json().catch(() => null));
    if (!cleaned.ok) return Response.json({ error: cleaned.error }, { status: 400 });
    const r = cleaned.request;
    const ip = await checkIpLimit(request, "supplier_ip", 10, 60 * 60);
    if (!ip.allowed) return rateLimitedResponse(ip);
    const em = await checkEmailLimit(r.email, "supplier_email", 3, 60 * 60);
    if (!em.allowed) return rateLimitedResponse(em);
    const { sql } = await import("~/db");
    await sql()`CREATE TABLE IF NOT EXISTS supplier_report_requests (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', business_type TEXT NOT NULL,
      state TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql()`INSERT INTO supplier_report_requests (email, company, business_type, state) VALUES (${r.email}, ${r.company}, ${r.type}, ${r.state})`;
    // The request is saved either way; the email is how the owner hears about it.
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const m = supplierNotice(r);
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: "Contrax <hello@contrax.company>",
          to: ["contrax.companyllc@gmail.com"],
          replyTo: r.email,
          subject: m.subject,
          text: m.text,
        });
      } catch (err) {
        console.error("[api/supplier-report] notice failed:", err instanceof Error ? err.message : "error");
      }
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("[api/supplier-report] error:", error instanceof Error ? error.message : "error");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/supplier-report")({
  server: { handlers: { POST: handler } },
});
