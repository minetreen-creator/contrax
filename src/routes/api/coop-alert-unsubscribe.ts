import { createFileRoute } from "@tanstack/react-router";

/** GET /api/coop-alert-unsubscribe?token=… — one-click unsubscribe from co-op trade alerts. */
const PAGE = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Contrax</title></head>
<body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:48px 20px;text-align:center;">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.12em;color:#b45309;text-transform:uppercase;">Contrax</p>
<h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${body}</p>
<a href="https://www.contrax.company/co-op-contracts" style="display:inline-block;margin-top:28px;background:#f59e0b;color:#0f172a;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;">Co-op contracts</a>
</div></body></html>`;

const html = (title: string, body: string, status = 200) =>
  new Response(PAGE(title, body), { status, headers: { "content-type": "text/html; charset=utf-8" } });

async function handler({ request }: { request: Request }) {
  const token = (new URL(request.url).searchParams.get("token") ?? "").trim();
  if (!token || token.length > 200) return html("Invalid link", "This unsubscribe link is invalid.");
  try {
    const { unsubscribeCoopAlert } = await import("~/lib/coop-alerts.server");
    const r = await unsubscribeCoopAlert(token);
    if (r === "missing") return html("Link not found", "This link doesn't match a Contrax co-op alert.");
    return html("You're unsubscribed ✓", "You won't get any more co-op alerts at this address.");
  } catch (err) {
    console.error("[api/coop-alert-unsubscribe] error:", (err as Error).message);
    return html("Something went wrong", "Please try the link again in a moment.", 500);
  }
}

export const Route = createFileRoute("/api/coop-alert-unsubscribe")({
  server: { handlers: { GET: handler } },
});
