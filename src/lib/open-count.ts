/**
 * The one definition of "open bids" the public pages count (owner 2026-11-14: the homepage said
 * 32,280 and /teams said 31,676 because each page had its own filter). Both now count rows that
 * pass this WHERE clause, so a visitor going from one to the other sees the same number, give or
 * take a bid posted between two page loads. PURE: a SQL string built from the shared filters.
 */
import { OPEN_BID_SQL, AWARD_NOTICE_EXCLUSION_SQL, CLOSED_EXCLUSION_SQL } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

export const PUBLIC_OPEN_BIDS_WHERE = [OPEN_BID_SQL, LOW_CONTENT_SQL, AWARD_EXCLUSION_SQL, AWARD_NOTICE_EXCLUSION_SQL, CLOSED_EXCLUSION_SQL].join("\n AND ");
