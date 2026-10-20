import { createFileRoute } from "@tanstack/react-router";
import { COUNTIES } from "~/lib/local-awards/model";
export const Route = createFileRoute("/api/county-locations")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(COUNTIES, {
          headers: {
            "cache-control": "public, max-age=86400, s-maxage=604800",
          },
        }),
    },
  },
});
