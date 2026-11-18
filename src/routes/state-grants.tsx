import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /state-grants — removed (owner 2026-11-18: "grants arent doing anything, delete grants"). Nobody had ever
 * subscribed and two people visited in 30 days. Old links and bookmarks land on the homepage.
 */
export const Route = createFileRoute("/state-grants")({
  beforeLoad: () => {
    throw redirect({ href: "/", statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
