/**
 * The 6 AM email's "Open to all businesses (no set-aside)" block (owner 2026-11-09, "yes add them to
 * the email alerts"). The morning digest never applied the small-business rule, so federal notices
 * that name no set-aside were already in it, mixed in with set-aside and state/local bids, along
 * with market research and overseas work. Same rules as Radar's section (radar-candidates.ts):
 * those bids are listed apart under their own label, and market research, intent notices and
 * work performed abroad are left out. Every other bid is untouched. PURE.
 */
import { isFederalNoSetAside, isForeignWork, NOT_A_BID_TITLE_RE } from "~/lib/radar-candidates";

/** Most open-to-all bids one email lists (soonest due first). */
export const OPEN_TO_ALL_EMAIL_MAX = 10;

export function splitDigestBids<T extends { title?: string | null; location?: string | null; set_aside?: string | null; source?: string | null }>(
  bids: readonly T[],
): { main: T[]; openToAll: T[]; dropped: number } {
  const main: T[] = [];
  const openToAll: T[] = [];
  let dropped = 0;
  for (const b of bids) {
    if (!isFederalNoSetAside(b)) {
      main.push(b);
    } else if (NOT_A_BID_TITLE_RE.test(String(b.title ?? "")) || isForeignWork(b)) {
      dropped++;
    } else {
      openToAll.push(b);
    }
  }
  return { main, openToAll, dropped };
}
