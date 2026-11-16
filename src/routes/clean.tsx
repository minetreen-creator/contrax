import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /clean — the short link on the "government cleaning jobs open now" Facebook post (owner
 * 2026-11-16). Sends the visitor to the search page with the campaign named, so Mission Control
 * shows who came from the post. Temporary redirect: the target can change. Same pattern as /ga.
 */
export const CLEAN_LINK_TARGET = "/radar?utm_source=facebook&utm_medium=social&utm_campaign=cleaning_jobs_post";

export const Route = createFileRoute("/clean")({
  beforeLoad: () => {
    throw redirect({ href: CLEAN_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
