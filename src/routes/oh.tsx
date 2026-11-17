import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /oh — the short link on the Ohio "job of the day" Facebook post (owner 2026-11-17). Sends the
 * visitor to the one bid the post is about, with the campaign named, so Mission Control shows who
 * came from the post. Temporary redirect: point OH_JOB_BID at the next day's bid to reuse the link.
 * Same pattern as /md and /va.
 */
/** 2026-11-17: City of Hudson, Stow Road Sidewalk Improvements, Ravenna Street to E. Streetsboro (SR 303) (due Dec 8). */
export const OH_JOB_BID = 2301967;
export const OH_LINK_TARGET = `/bid/${OH_JOB_BID}?utm_source=facebook&utm_medium=social&utm_campaign=oh_job_of_the_day`;

export const Route = createFileRoute("/oh")({
  beforeLoad: () => {
    throw redirect({ href: OH_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
