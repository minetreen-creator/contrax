import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MCP_PROTOCOLS, MCP_ROWS, MCP_TOOLS, handleMcp, type McpMarket } from "./mcp";

// Owner 2026-11-14 (competitor review, idea 7): let customers ask an AI assistant about Contrax data.
const market: McpMarket = {
  state: "VA", stateName: "Virginia", trade: "it-services", tradeLabel: "IT services", asOf: "2026-11-14", until: "2027-11-14",
  totals: { n: 6382, total: 61226036244.4, holders: 1219 },
  priceRange: { low: 100000.2, median: 900000.7, high: 5000000 },
  byAgency: Array.from({ length: 12 }, (_, i) => ({ agency: `Agency ${i}`, n: 10 - i, total: 1e9 - i })),
  largest: Array.from({ length: 25 }, (_, i) => ({ award_key: `CONT_AWD_${i}`, recipient_name: `Holder ${i}`, amount: 1e9 - i, end_date: "2026-11-27", agency: "GSA", sub_agency: i ? null : "Federal Acquisition Service" })),
  holders: Array.from({ length: 10 }, (_, i) => ({ recipient_name: `Co ${i}`, n: 5, total: 1e8 })),
  openBids: [{ id: 7, title: "General IT Services", agency: "Town of Bridgewater", due: "2026-11-30" }],
};
const deps = { market: async () => market };
const call = (method: string, params?: unknown, id: unknown = 1) => handleMcp({ jsonrpc: "2.0", id, method, params }, deps) as Promise<any>;

test("initialize agrees a protocol version and offers tools only", async () => {
  const r = await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  expect(r.result.protocolVersion).toBe("2025-03-26");
  expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
  expect(r.result.serverInfo.name).toBe("contrax");
  expect((await call("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe(MCP_PROTOCOLS[0]);
});

test("notifications get no reply; ping and unknown methods answer properly", async () => {
  expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, deps)).toBeNull();
  expect((await call("ping")).result).toEqual({});
  expect((await call("resources/list")).error.code).toBe(-32601);
  expect((await handleMcp("nope", deps) as any).error.code).toBe(-32600);
});

test("two read-only tools are listed with schemas", async () => {
  const tools = (await call("tools/list")).result.tools;
  expect(tools.map((t: any) => t.name)).toEqual(["contracts_ending_soon", "list_trades"]);
  expect(tools[0].inputSchema.required).toEqual(["state", "trade"]);
  expect(MCP_TOOLS.every((t) => t.annotations.readOnlyHint)).toBe(true);
});

test("a market comes back as totals plus a handful of rows, with the caution and links", async () => {
  const r = await call("tools/call", { name: "contracts_ending_soon", arguments: { state: "va", trade: "it-services" } });
  const d = r.result.structuredContent;
  expect(r.result.isError).toBeUndefined();
  expect(JSON.parse(r.result.content[0].text)).toEqual(d);
  expect(d.contracts_ending).toBe(6382);
  expect(d.combined_award_value_usd).toBe(61226036244);
  expect(d.largest_ending_within_6_months.length).toBe(MCP_ROWS);
  expect(d.largest_ending_within_6_months[0]).toEqual({ holder: "Holder 0", agency: "Federal Acquisition Service", award_value_usd: 1000000000, ends: "2026-11-27", record: "https://www.usaspending.gov/award/CONT_AWD_0" });
  expect(d.agencies_with_most_ending.length).toBe(MCP_ROWS);
  expect(d.caution).toContain("not a promise that the work will be rebid");
  expect(d.full_list).toBe("https://www.contrax.company/recompetes?trade=it-services&state=VA");
});

test("bad input, a rate limit and a data failure are tool errors, not crashes", async () => {
  const bad = await call("tools/call", { name: "contracts_ending_soon", arguments: { state: "ZZ", trade: "it-services" } });
  expect(bad.result.isError).toBe(true);
  expect((await call("tools/call", { name: "contracts_ending_soon", arguments: { state: "VA", trade: "plumbing" } })).result.isError).toBe(true);
  expect((await call("tools/call", { name: "nope" })).error.code).toBe(-32602);
  const limited = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "contracts_ending_soon", arguments: { state: "VA", trade: "it-services" } } }, deps, async () => false) as any;
  expect(limited.result.isError).toBe(true);
  const broken = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "contracts_ending_soon", arguments: { state: "VA", trade: "it-services" } } }, { market: async () => { throw new Error("db"); } }) as any;
  expect(broken.result.isError).toBe(true);
  expect((await call("tools/call", { name: "list_trades" })).result.structuredContent.trades.length).toBeGreaterThan(5);
});

test("the route is POST-only JSON, rate-limits data calls and reads through the report function", () => {
  const route = readFileSync("src/routes/api/mcp.ts", "utf8");
  expect(route).toContain('checkIpLimit(request, "mcp_tools_call_ip", 40, 3600)');
  expect(route).toContain("reportData(state, trade, 12)");
  expect(route).toContain("GET: notAllowed");
  expect(readFileSync("public/llms.txt", "utf8")).toContain("https://www.contrax.company/api/mcp");
});

// Owner 2026-11-14 (traffic idea 3): a public page for the connection, and the offer on state pages.
test("the /mcp page reads its tools from the endpoint's own list and is in the sitemap and llms.txt", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("src/routes/mcp.tsx", "utf8");
  expect(page).toContain("MCP_TOOLS.map((t) =>");
  expect(page).toContain('export const MCP_URL = "https://www.contrax.company/api/mcp"');
  // The stated limit is the one the endpoint enforces.
  expect(page).toContain("export const MCP_CALLS_PER_HOUR = 40;");
  expect(readFileSync("src/routes/api/mcp.ts", "utf8")).toContain('"mcp_tools_call_ip", 40, 3600');
  expect(readFileSync("scripts/generate-sitemap.mjs", "utf8")).toContain('["/mcp", "monthly", "0.6"]');
  expect(readFileSync("public/llms.txt", "utf8")).toContain("https://www.contrax.company/mcp)");
});

test("state pages name both prepared reports at the site's prices", async () => {
  const { readFileSync } = await import("node:fs");
  const block = readFileSync("src/components/PreparedForYou.tsx", "utf8");
  expect(block).toContain("Pipeline Snapshot · {REPORT_PRICE} once");
  expect(block).toContain('export const MANAGED_PRICE_LINE = "$499 a month"');
  expect(readFileSync("src/routes/teams.tsx", "utf8")).toContain('export const MANAGED_PRICE = "$499"');
  expect(readFileSync("src/routes/contracts-in.$state.tsx", "utf8")).toContain("<PreparedForYou stateName={data.name} />");
});
