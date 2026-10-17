import { createFileRoute } from "@tanstack/react-router";
import { countyFor } from "~/lib/local-awards/model";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBotUa } from "~/lib/radar-lead-capture.server";
async function handler({ request }: { request: Request }) {
  const q = new URL(request.url).searchParams;
  const county = countyFor(q.get("county"));
  const naics = q.get("naics");
  if (!county || (naics && !/^\d{6}$/.test(naics)))
    return Response.json(
      { error: "Choose a valid county or independent city." },
      { status: 400 },
    );
  const rate = await checkIpLimit(request, "local_awards", 60, 3600);
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const { localAwards } = await import("~/lib/local-awards/cache.server");
    const result = await localAwards(
      county,
      naics,
      !isBotUa(request.headers.get("user-agent")),
    );
    return Response.json(result, {
      headers: { "cache-control": "public, max-age=300, s-maxage=3600" },
    });
  } catch (error) {
    console.error("[local-awards]", (error as Error).message);
    return Response.json(
      {
        error:
          "Figures are being prepared or are temporarily unavailable for this area. Try again later.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
export const Route = createFileRoute("/api/local-awards")({
  server: { handlers: { GET: handler } },
});
