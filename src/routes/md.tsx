import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /md — the short link on the Maryland "job of the day" Facebook post (owner 2026-11-16). Sends the
 * visitor to the one bid the post is about, with the campaign named, so Mission Control shows who
 * came from the post. Temporary redirect: point MD_JOB_BID at the next day's bid to reuse the link.
 * Same pattern as /va.
 */
/** 2026-11-16: Maryland Transit Administration, Light Rail and Metro facilities repairs, maintenance and minor construction, MDL-26-002-AN (due Nov 30). */
export const MD_JOB_BID = 142387;
export const MD_LINK_TARGET = `/bid/${MD_JOB_BID}?utm_source=facebook&utm_medium=social&utm_campaign=md_job_of_the_day`;

export const Route = createFileRoute("/md")({
  beforeLoad: () => {
    throw redirect({ href: MD_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
