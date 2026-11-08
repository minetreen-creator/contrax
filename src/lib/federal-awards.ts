/** Server function for /awards' real federal awards (see ~/lib/federal-awards-view). */
import { createServerFn } from "@tanstack/react-start";
import {
  AWARDS_FREE_ROWS,
  AWARDS_MEMBER_ROWS,
  EMPTY_AWARDS_SUMMARY,
  awardLikePattern,
  cleanAwardQuery,
  cleanAwardState,
  type FederalAwardsData,
} from "~/lib/federal-awards-view";

export const getFederalAwards = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ q: cleanAwardQuery((d as { q?: unknown })?.q), state: cleanAwardState((d as { state?: unknown })?.state) }))
  .handler(async ({ data }): Promise<FederalAwardsData> => {
    let paid = false;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      const { hasPaidBidAccess } = await import("~/lib/head-start.server");
      paid = await hasPaidBidAccess(await getCurrentUser());
    } catch {
      paid = false; // fail closed: a lookup error never shows the member list
    }
    try {
      const { queryFederalAwards } = await import("~/lib/federal-trade-data.server");
      const r = await queryFederalAwards({
        like: data.q ? awardLikePattern(data.q) : null,
        state: data.state || null,
        // The member list never leaves the server for a free viewer.
        listLimit: paid ? AWARDS_MEMBER_ROWS : AWARDS_FREE_ROWS,
      });
      return { q: data.q, state: data.state, summary: r.summary, awards: r.awards, paid, memberLimit: AWARDS_MEMBER_ROWS };
    } catch (e) {
      console.error("[awards] federal awards query failed:", (e as Error).message);
      return { q: data.q, state: data.state, summary: EMPTY_AWARDS_SUMMARY, awards: [], paid, memberLimit: AWARDS_MEMBER_ROWS, error: true };
    }
  });
