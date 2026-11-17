import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /il — the short link on the Illinois construction Facebook post (owner 2026-11-16). Sends the
 * visitor to the Illinois construction page with the campaign named, so Mission Control shows
 * who came from the post. Temporary redirect: the target can change. Same pattern as /ga.
 */
export const IL_LINK_TARGET = "/contracts-in/illinois/construction?utm_source=facebook&utm_medium=social&utm_campaign=il_construction_post";

export const Route = createFileRoute("/il")({
  beforeLoad: () => {
    throw redirect({ href: IL_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
