import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /ga — the short link on the Georgia construction Facebook post (owner 2026-11-15). Sends the
 * visitor to the Georgia construction page with the campaign named, so Mission Control shows
 * who came from the post. Temporary redirect: the target can change. Same pattern as /ny and /ca.
 */
export const GA_LINK_TARGET = "/contracts-in/georgia/construction?utm_source=facebook&utm_medium=social&utm_campaign=ga_construction_post";

export const Route = createFileRoute("/ga")({
  beforeLoad: () => {
    throw redirect({ href: GA_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
