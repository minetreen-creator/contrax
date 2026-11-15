import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /ca — the short link on the California construction Facebook post (owner 2026-11-14). Sends the
 * visitor to the California construction page with the campaign named, so Mission Control shows
 * who came from the post. Temporary redirect: the target can change. Same pattern as /ny.
 */
export const CA_LINK_TARGET = "/contracts-in/california/construction?utm_source=facebook&utm_medium=social&utm_campaign=ca_construction_post";

export const Route = createFileRoute("/ca")({
  beforeLoad: () => {
    throw redirect({ href: CA_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
