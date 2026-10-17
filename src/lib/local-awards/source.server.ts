import {
  filtersFor,
  parseAction,
  cents,
  TRANSACTION_FIELDS,
  type County,
  type Snapshot,
} from "./model";
const API = "https://api.usaspending.gov/api/v2";
export async function post(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error("Spending refresh timed out");
    if (attempt)
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
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
    if (!data.page_metadata.hasNext) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error("Category pagination incomplete");
  const total = rows.reduce((sum, a) => sum + a.cents, 0);
  if (total !== categoryCents)
    throw new Error(
      `Reconciliation failed: actions ${total}, categories ${categoryCents}; no figures published`,
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
