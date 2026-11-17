/**
 * "All open bids" list pages (owner 2026-11-17). Google had read 726 of the site's pages and left
 * 31,043 as "Discovered - currently not indexed": it knew the bid pages from the sitemap, but almost
 * no page on the site linked to them. A landing page shows at most 25 to 60 bids. These pages list
 * every open bid in a state as plain links, 100 to a page, so each bid page is a few links from the
 * homepage. Real bids only; nothing here is written by hand. PURE and client-safe.
 */
import { STATE_NAMES } from "~/lib/contract-map";

export const OPEN_BIDS_PAGE_SIZE = 100;
/** Bids with no state on them (mostly federal notices) are listed under this slug. */
export const NATIONWIDE_SLUG = "nationwide";

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
export const OPEN_BIDS_STATES: readonly { code: string; name: string; slug: string }[] = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name, slug: slugOf(name) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const BY_SLUG = new Map(OPEN_BIDS_STATES.map((s) => [s.slug, s]));

/** The list page for a state given by name ("New York"), or null when it is not a state. */
export function openBidsHrefForState(name: string | null | undefined): string | null {
  const s = BY_SLUG.get(slugOf(String(name ?? "")));
  return s ? openBidsHref(s.slug) : null;
}

/** The state a slug names; `code` is null for the nationwide list; null for an unknown slug. */
export function openBidsPlace(slug: string): { code: string | null; name: string; slug: string } | null {
  const s = String(slug ?? "").toLowerCase();
  if (s === NATIONWIDE_SLUG) return { code: null, name: "no single state", slug: NATIONWIDE_SLUG };
  return BY_SLUG.get(s) ?? null;
}

export function openBidsPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / OPEN_BIDS_PAGE_SIZE));
}

/** A whole page number from 1 up; anything else is page 1. */
export function openBidsPage(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 1;
}

export function openBidsHref(slug: string, page = 1): string {
  return page > 1 ? `/open-bids/${slug}?page=${page}` : `/open-bids/${slug}`;
}

/** Page numbers to link: the first, the last, and a window around the current one. */
export function openBidsPageLinks(page: number, pages: number): number[] {
  const out = new Set<number>([1, pages]);
  for (let p = page - 3; p <= page + 3; p++) if (p >= 1 && p <= pages) out.add(p);
  return [...out].sort((a, b) => a - b);
}
