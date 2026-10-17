import { createFileRoute } from "@tanstack/react-router";
// Compatibility endpoint for old clients and cached banners. No new $9 checkouts.
async function handler(): Promise<Response> {
  return Response.json(
    {
      available: false,
      remaining: 0,
      limit: 10,
      monthlyUsd: 9,
      retired: true,
      replacement: "/founding-businesses",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/founding-offer")({
  server: { handlers: { GET: handler } },
});
