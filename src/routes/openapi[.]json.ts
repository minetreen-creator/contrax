import { createFileRoute } from "@tanstack/react-router";
import { DATA_FEED_OPENAPI } from "~/lib/data-feed-openapi";

/** /openapi.json — the bid data feed's OpenAPI description (for API marketplaces and developers). */
export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: () =>
        Response.json(DATA_FEED_OPENAPI, {
          headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
        }),
    },
  },
});
