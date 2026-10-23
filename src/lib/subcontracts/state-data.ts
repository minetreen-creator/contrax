import { createServerFn } from "@tanstack/react-start";
import type { AwardLead } from "~/lib/award-leads";
import type { PrimeRowView, SubcontractNoticeView } from "./read";
import { pickWinners, stateFromSlug, WINNER_DAYS, WINNER_MIN_AMOUNT, type StateRef } from "./state-page";

/** Server side of /subcontracts-in/:state (state-page.ts). */

export interface StateSubcontractsData {
  state: StateRef | null;
  /** Open SBA SUBNet notices in the state; null when the store couldn't be read. */
  notices: SubcontractNoticeView[] | null;
  /** Primes in the SBA FY24 directory (they hold subcontracting plans) based in the state. */
  primes: PrimeRowView[] | null;
  primesTotal: number;
  /** Biggest recent federal winners there, one per company. */
  winners: AwardLead[] | null;
  winnersTotal: number;
}

export const getStateSubcontracts = createServerFn({ method: "GET" })
  .validator((slug: string) => String(slug ?? "").slice(0, 40))
  .handler(async ({ data }): Promise<StateSubcontractsData> => {
    const state = stateFromSlug(data);
    const out: StateSubcontractsData = { state, notices: null, primes: null, primesTotal: 0, winners: null, winnersTotal: 0 };
    if (!state) return out;
    const { readSubcontractsPayload, readPrimesPayload } = await import("./read.server");
    const { isUnavailable, isPrimesQueryError } = await import("./read");
    const [notices, primes, winners] = await Promise.allSettled([
      readSubcontractsPayload(),
      readPrimesPayload({ naics: null, state: state.name.toUpperCase(), page: 1, limit: 25 }),
      (async () => {
        const { queryAwardLeads } = await import("~/lib/award-leads.server");
        const since = new Date(Date.now() - WINNER_DAYS * 86_400_000).toISOString().slice(0, 10);
        return queryAwardLeads({ states: [state.code], naics: [], since, minAmount: WINNER_MIN_AMOUNT, limit: 1000, after: 0 });
      })(),
    ]);
    if (notices.status === "fulfilled" && !isUnavailable(notices.value)) {
      out.notices = notices.value.rows.filter((r) => r.stateCode === state.code);
    } else if (notices.status === "rejected") {
      console.error("[subcontracts-in] notices failed:", notices.reason);
    }
    if (primes.status === "fulfilled" && !isPrimesQueryError(primes.value) && !isUnavailable(primes.value)) {
      out.primes = primes.value.rows;
      out.primesTotal = primes.value.counts.filtered;
    } else if (primes.status === "rejected") {
      console.error("[subcontracts-in] primes failed:", primes.reason);
    }
    if (winners.status === "fulfilled") {
      const rows = winners.value.rows as AwardLead[];
      out.winnersTotal = new Set(rows.map((r) => (r.recipient_uei || r.recipient_name).toUpperCase())).size;
      out.winners = pickWinners(rows);
    } else {
      console.error("[subcontracts-in] award leads failed:", winners.reason);
    }
    return out;
  });
