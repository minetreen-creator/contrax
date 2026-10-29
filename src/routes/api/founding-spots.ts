import { createFileRoute } from "@tanstack/react-router";
import { foundingBusinessPageData } from "~/lib/founding-business.server";
import { FOUNDING_BUSINESS_LIMIT } from "~/lib/founding-business";

/**
 * GET /api/founding-spots — the live count of open Founding Business spots
 * (owner 2026-10-29: show the offer on the notice lock and the Basic bar).
 * `remaining` is null when the count can't be read, so callers show nothing
 * rather than a guess. `listings` are the published Founding Businesses, the
 * same public profiles /founding-businesses shows (homepage wall).
 */
async function handler(): Promise<Response> {
  const data = await foundingBusinessPageData();
  return Response.json(
    { remaining: data.available ? data.remaining : null, limit: FOUNDING_BUSINESS_LIMIT, listings: data.listings },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}

export const Route = createFileRoute("/api/founding-spots")({
  server: { handlers: { GET: handler } },
});
