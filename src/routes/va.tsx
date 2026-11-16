import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /va — the short link on the Virginia "job of the day" Facebook post (owner 2026-11-16). Sends the
 * visitor to the one bid the post is about, with the campaign named, so Mission Control shows who
 * came from the post. Temporary redirect: point VA_JOB_BID at the next day's bid to reuse the link.
 * Same pattern as /ny, /ca and /ga.
 */
/** 2026-11-16: Virginia State Police, janitorial services, Area Office 49 Christiansburg (due Nov 30). */
export const VA_JOB_BID = 1862782;
export const VA_LINK_TARGET = `/bid/${VA_JOB_BID}?utm_source=facebook&utm_medium=social&utm_campaign=va_job_of_the_day`;

export const Route = createFileRoute("/va")({
  beforeLoad: () => {
    throw redirect({ href: VA_LINK_TARGET, statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
