import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /j/<bid id> — the short link on a "job of the day" Facebook post (owner 2026-11-17: five posts a
 * day, in five states). One link shape for every post, so a new post needs no new route: it sends
 * the visitor to that bid with the campaign named, and Mission Control shows who came from the post.
 * Anything that is not a bid number goes to the search page.
 */
export function jobLinkTarget(id: string): string {
  return /^\d{1,9}$/.test(id)
    ? `/bid/${id}?utm_source=facebook&utm_medium=social&utm_campaign=job_of_the_day`
    : "/radar?utm_source=facebook&utm_medium=social&utm_campaign=job_of_the_day";
}

export const Route = createFileRoute("/j/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: jobLinkTarget(params.id), statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
