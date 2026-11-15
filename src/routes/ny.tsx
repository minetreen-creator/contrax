import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /ny — the short link on the New York Facebook post (owner 2026-11-14: "a flashy facebook post
 * aimed at NY with a special link"). Sends the visitor to the New York page with the campaign
 * named, so Mission Control shows who came from the post. Temporary redirect: the target can change.
 */
export const NY_LINK_TARGET = "/contracts-in/new-york?utm_source=facebook&utm_medium=social&utm_campaign=ny_post";

export const Route = createFileRoute("/ny")({
  beforeLoad: () => {
    throw redirect({ href: NY_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
