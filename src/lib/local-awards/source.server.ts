import {
  filtersFor,
  parseAction,
  cents,
  TRANSACTION_FIELDS,
  type County,
  type Snapshot,
} from "./model";
const API = "https://api.usaspending.gov/api/v2";
// USAspending starts closing sockets after a few minutes of steady paging
// (2026-10-26: every county after the first ~4 minutes failed, run after run).
// Waits of 0.5 s and 1 s were too short to outlast that, so back off longer.
// Only the hourly sync job calls this, so the extra wait never reaches a visitor.
export const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];
export async function post(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) throw new Error("Spending refresh timed out");
    if (attempt)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    try {
      const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Contrax/1.0 (+https://www.contrax.company)",
          Connection: "close",
        },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(40000),
        keepalive: false,
      });
      if (!response.ok) {
        const error = Object.assign(
          new Error(`USAspending ${response.status} at ${path}`),
          { permanent: response.status < 500 && response.status !== 429 },
        );
        throw error;
      }
      return await response.json();
    } catch (error) {
      if ((error as { permanent?: boolean }).permanent) throw error;
      last = error;
    }
  }
  throw last;
}
export async function fetchSnapshot(
  county: County,
  start: string,
  end: string,
  signal?: AbortSignal,
  fetcher = post,
): Promise<Snapshot> {
  const filters = filtersFor(county, start, end);
  const rows: Snapshot["actions"] = [];
  let complete = false;
  for (let page = 1; page <= 500; page++) {
    const data = await fetcher(
      "/search/spending_by_transaction/",
      {
        filters,
        fields: TRANSACTION_FIELDS,
        limit: 100,
        page,
        sort: "Transaction Amount",
        order: "desc",
      },
      signal,
    );
    if (
      !Array.isArray(data.results) ||
      typeof data.page_metadata?.hasNext !== "boolean"
    )
      throw new Error("Invalid transaction pagination");
    rows.push(
      ...data.results.map((r: Record<string, any>) =>
        parseAction(r, start, end),
      ),
    );
    // These are individual actions, not award rows. Never deduplicate them by
    // award id, modification, date or amount: legitimate amendments repeat.
    if (!data.page_metadata.hasNext) {
      complete = true;
      break;
    }
    if (!data.results.length)
      throw new Error("Empty incomplete transaction page");
  }
  if (!complete)
    throw new Error(
      "Transaction pagination cap exceeded; no partial totals published",
    );
  let categoryCents = 0;
  let categoryRows = 0;
  complete = false;
  for (let page = 1; page <= 100; page++) {
    const data = await fetcher(
      "/search/spending_by_category/naics/",
      { filters, spending_level: "transactions", limit: 100, page },
      signal,
    );
    if (
      !Array.isArray(data.results) ||
      typeof data.page_metadata?.hasNext !== "boolean"
    )
      throw new Error("Invalid category pagination");
    categoryCents += data.results.reduce(
      (sum: number, r: { amount: unknown }) => sum + cents(r.amount),
      0,
    );
    categoryRows += data.results.length;
    if (!data.page_metadata.hasNext) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error("Category pagination incomplete");
  const total = rows.reduce((sum, a) => sum + a.cents, 0);
  const delta = total - categoryCents;
  if (Math.abs(delta) > reconciliationToleranceCents(categoryRows))
    throw new Error(
      `Reconciliation failed: actions ${total}, categories ${categoryCents}; no figures published`,
    );
  if (delta !== 0)
    console.log(
      `[local-awards] ${county.fips} reconciled within category rounding: delta ${delta} cent(s) over ${categoryRows} categories`,
    );
  return {
    county,
    start,
    end,
    fetchedAt: new Date().toISOString(),
    actions: rows,
    categoryCents,
  };
}

/**
 * How far the action total may sit from the category total (owner 2026-10-19).
 * USAspending rounds each NAICS category's sum to the cent before we add the
 * categories up, so each one can be off by up to half a cent. Anything beyond
 * that is a real mismatch and still blocks publication.
 */
export function reconciliationToleranceCents(categoryRows: number): number {
  return Math.max(1, Math.ceil(categoryRows / 2));
}
