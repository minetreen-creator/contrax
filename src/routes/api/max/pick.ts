import { createFileRoute } from "@tanstack/react-router";
import { stateFromGeoHeaders } from "~/lib/radar-geo";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { maxLang, maxPickGreeting } from "~/lib/max";
import { maxPickOfTheDay } from "~/lib/max.server";

/**
 * GET /api/max/pick?lang=en|es|zh — Max's pick of the day for the homepage
 * greeting (src/lib/max.ts maxPickGreeting): one open bid in the visitor's
 * state from Vercel's IP geo, nationwide when unknown. No AI call. Returns
 * { pick: null } when nothing fits; the page then shows the usual chips.
 */
async function handler({ request }: { request: Request }) {
  const lang = maxLang(new URL(request.url).searchParams.get("lang"));
  const state = stateFromGeoHeaders(request.headers.get("x-vercel-ip-country"), request.headers.get("x-vercel-ip-country-region")) || null;
  try {
    const local = state ? await maxPickOfTheDay(state) : null;
    const pick = local ?? (await maxPickOfTheDay(null));
    if (!pick) return Response.json({ pick: null });
    // Only say "in Virginia" when the pick really is from the visitor's state.
    const stateName = local && state ? STATE_CODE_TO_NAME[state] ?? null : null;
    return Response.json(
      { pick, state, say: maxPickGreeting(pick, stateName, lang) },
      { headers: { "Cache-Control": "private, max-age=600" } },
    );
  } catch (err) {
    console.error("[api/max/pick] failed:", (err as Error)?.message);
    return Response.json({ pick: null });
  }
}

export const Route = createFileRoute("/api/max/pick")({ server: { handlers: { GET: handler } } });
