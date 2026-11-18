import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /prep — the short link for Bid Prep (owner 2026-11-17, "we should push the bid prep offer"): on the
 * Facebook post, in the bid emails and above search results. Sends the visitor to the Bid Prep
 * section of the contractors page with the place they came from named, so Mission Control shows it.
 */
export function prepLinkTarget(source: string | undefined): string {
  const from = /^[a-z_]{1,30}$/.test(source ?? "") ? source : "facebook";
  // Owner 2026-11-18: the Bid Prep section moved with the rest of the contractor page.
  return `/contractors?utm_source=${from}&utm_medium=${from === "facebook" ? "social" : "site"}&utm_campaign=bid_prep#bid-prep`;
}

export const Route = createFileRoute("/prep")({
  validateSearch: (s: Record<string, unknown>): { source?: string } => (typeof s.source === "string" ? { source: s.source } : {}),
  beforeLoad: ({ search }) => {
    throw redirect({ href: prepLinkTarget(search.source), statusCode: 302 });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex, follow" }] }),
});
