import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { WINNERS_SESSION_RE, winnersCsv, winnersFileName } from "~/lib/state-winners";
import { fetchWinners, paidStateForSession } from "~/lib/state-winners.server";

/** GET ?session=cs_… → the buyer's file. Only a paid Stripe session for this product opens it. */
async function handler({ request }: { request: Request }) {
  const session = new URL(request.url).searchParams.get("session") ?? "";
  if (!WINNERS_SESSION_RE.test(session)) return new Response("This download link is not valid.", { status: 400 });
  const ip = await checkIpLimit(request, "state_winners_download_ip", 30, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const state = await paidStateForSession(session);
  if (!state) return new Response("We could not find a paid order for this link. Email contrax.companyllc@gmail.com and we will sort it out.", { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  try {
    const rows = await fetchWinners(state, today);
    return new Response(winnersCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${winnersFileName(state, today)}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("[state-winners/download] failed", error);
    return new Response("The federal records site did not answer just now. Your order is safe: try this link again in a few minutes, or email contrax.companyllc@gmail.com.", { status: 503 });
  }
}

export const Route = createFileRoute("/api/state-winners/download")({ server: { handlers: { GET: handler } } });
