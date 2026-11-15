import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { accountSlice, endingMarket } from "~/lib/ending-pages";
import { checkIpLimit } from "~/lib/rate-limit";

/**
 * GET /api/ending-list?state=virginia&trade=janitorial — the full list behind a
 * /contracts-ending page (owner 2026-11-14: "gate the full 25-contract list and agency breakdown
 * behind a free account"; then "1": a free account gets 10 rows, Professional gets all 25 and the
 * agencies). A visitor gets 401 and the page offers the free account. The page calls this only when asked, so a crawler never does.
 */
async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await checkIpLimit(request, "ending_list_ip", 60, 3600)).allowed) return Response.json({ error: "Too many requests. Try again in an hour." }, { status: 429 });
  const url = new URL(request.url);
  const market = endingMarket(url.searchParams.get("state") ?? "", url.searchParams.get("trade") ?? "");
  if (!market) return Response.json({ error: "Unknown state or trade" }, { status: 404 });
  try {
    // Fail closed: if the plan cannot be read, the account gets the free 10.
    let professional = false;
    try {
      const { hasProfessionalAccess, loadUserTrialStatus } = await import("~/lib/trial");
      professional = hasProfessionalAccess(await loadUserTrialStatus(user.id), user);
    } catch (e) {
      console.warn("[ending-list] plan check failed (showing the free rows):", (e as Error).message);
    }
    const { reportData } = await import("~/lib/pipeline-report-data.server");
    return Response.json(accountSlice(await reportData(market.code, market.trade, 12), professional), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[ending-list] failed", e);
    return Response.json({ error: "Could not load the list" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/ending-list")({ server: { handlers: { GET: get } } });
