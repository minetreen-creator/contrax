/**
 * A Model Context Protocol endpoint for Contrax (owner 2026-11-14, competitor review idea 7:
 * the self-serve tools let customers ask Claude or ChatGPT about their data). PURE: turns one
 * JSON-RPC message into its reply. The route at /api/mcp supplies the data function and the
 * rate limit. It is stateless (no sessions, no streaming) and read-only, and it gives the same
 * taste the public pages give: the totals and a handful of rows, with a link to the rest.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

export const MCP_SERVER = { name: "contrax", title: "Contrax government contracts", version: "1.0.0" };
/** Protocol revisions this endpoint answers; the first is offered when a client asks for another. */
export const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_ROWS = 5;

export interface McpMarket {
  state: string;
  stateName: string;
  trade: string;
  tradeLabel: string;
  asOf: string;
  until: string;
  totals: { n: number; total: number; holders: number };
  priceRange: { low: number; median: number; high: number } | null;
  byAgency: { agency: string; n: number; total: number }[];
  largest: { award_key: string; recipient_name: string; amount: number; end_date: string; agency: string | null; sub_agency: string | null }[];
  holders: { recipient_name: string; n: number; total: number }[];
  openBids: { id: number; title: string; agency: string | null; due: string }[];
}

export interface McpDeps {
  market: (state: string, trade: string) => Promise<McpMarket>;
}

const TRADE_SLUGS = SEO_TRADES.map((t) => t.slug);

export const MCP_TOOLS = [
  {
    name: "contracts_ending_soon",
    title: "Federal contracts ending soon",
    description:
      "Federal contracts in one line of work whose end date falls in the next 12 months in one US state: how many, their combined award value, how many companies hold them, the typical award size, the largest ones ending within 6 months, the agencies and companies with the most, and open bids that fit. Source: USAspending.gov records gathered by Contrax. An ending contract is not a promise that the work will be rebid.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Two-letter US state code, for example VA" },
        trade: { type: "string", enum: TRADE_SLUGS, description: "Line of work" },
      },
      required: ["state", "trade"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_trades",
    title: "Lines of work Contrax tracks",
    description: "The lines of work (trades) that contracts_ending_soon accepts, with their plain names.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

type Json = Record<string, unknown>;
const ok = (id: unknown, result: Json) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolText = (id: unknown, data: Json, isError = false) =>
  ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : { structuredContent: data }) });

/** The public shape of one market: totals, a handful of rows, and where the rest is. */
export function marketResult(m: McpMarket): Json {
  const site = "https://www.contrax.company";
  return {
    state: m.stateName,
    line_of_work: m.tradeLabel,
    as_of: m.asOf,
    window_ends: m.until,
    contracts_ending: m.totals.n,
    combined_award_value_usd: Math.round(m.totals.total),
    companies_holding_them: m.totals.holders,
    typical_award_usd: m.priceRange ? { middle_half_from: Math.round(m.priceRange.low), midpoint: Math.round(m.priceRange.median), middle_half_to: Math.round(m.priceRange.high) } : null,
    largest_ending_within_6_months: m.largest.slice(0, MCP_ROWS).map((c) => ({
      holder: c.recipient_name, agency: c.sub_agency ?? c.agency, award_value_usd: Math.round(c.amount), ends: c.end_date,
      record: `https://www.usaspending.gov/award/${encodeURIComponent(c.award_key)}`,
    })),
    agencies_with_most_ending: m.byAgency.slice(0, MCP_ROWS).map((a) => ({ agency: a.agency, contracts: a.n, award_value_usd: Math.round(a.total) })),
    companies_holding_most: m.holders.slice(0, MCP_ROWS).map((h) => ({ company: h.recipient_name, contracts: h.n, award_value_usd: Math.round(h.total) })),
    open_bids_that_fit: m.openBids.slice(0, MCP_ROWS).map((b) => ({ title: b.title, agency: b.agency, due: b.due, link: `${site}/bid/${b.id}` })),
    caution: "Award values are as USAspending.gov reports them, not yearly spending. End dates can move. An ending contract is not a promise that the work will be rebid.",
    full_list: `${site}/recompetes?trade=${m.trade}&state=${m.state}`,
    report_prepared_for_you: `${site}/sample-report`,
    source: "USAspending.gov contract records, gathered by Contrax (contrax.company)",
  };
}

/**
 * One JSON-RPC message in, its reply out. Null means "no reply" (a notification).
 * `allowCall` is the rate limit's answer for a tools/call; false returns a tool error.
 */
export async function handleMcp(msg: unknown, deps: McpDeps, allowCall: () => Promise<boolean> = async () => true): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Invalid request");
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(m.id, -32600, "Invalid request");
  const isNotification = m.id === undefined;
  if (isNotification) return null;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOLS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOLS[0];
      return ok(m.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER,
        instructions: "Read-only public data about US federal contracts that are ending soon, by state and line of work. Call list_trades for the accepted lines of work. Always pass on the caution in each result.",
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = params.name;
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Json;
      if (name === "list_trades") return toolText(m.id, { trades: SEO_TRADES.map((t) => ({ trade: t.slug, name: t.label })) });
      if (name !== "contracts_ending_soon") return fail(m.id, -32602, `Unknown tool: ${String(name)}`);
      const state = typeof args.state === "string" ? args.state.trim().toUpperCase() : "";
      const trade = typeof args.trade === "string" ? args.trade.trim().toLowerCase() : "";
      if (!STATE_NAMES[state]) return toolText(m.id, { error: "state must be a two-letter US state code, for example VA" }, true);
      if (!SEO_TRADE_BY_SLUG[trade]) return toolText(m.id, { error: `trade must be one of: ${TRADE_SLUGS.join(", ")}` }, true);
      if (!(await allowCall())) return toolText(m.id, { error: "Too many requests from this address. Try again in an hour, or see https://www.contrax.company/recompetes" }, true);
      try {
        return toolText(m.id, marketResult(await deps.market(state, trade)));
      } catch {
        return toolText(m.id, { error: "The data could not be read just now. Try again shortly." }, true);
      }
    }
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}
