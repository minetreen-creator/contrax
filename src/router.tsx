import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Every search param this app uses (q, plan, next, ticker_bid, ticker_agency,
// session_id, search, text, token, save_bid, ...) is a PLAIN STRING. TanStack's
// default serialization JSON-coerces values that look like JSON: `?q=238220` (a
// NAICS code) parses to the NUMBER 238220, and — worse — stringifies a numeric
// STRING "238220" as `?q="238220"` (JSON-quoted) because "238220" is
// JSON-parseable. That asymmetric round-trip produced a 307 redirect canonically
// quoting/stripping all-numeric queries (the NAICS silently-vanishes bug:
// ?q=238220 -> /?qa=...). A string-only parse/stringify is symmetric, does no
// number/JSON coercion, and keeps numeric NAICS/trade queries stable in the URL.
function parseSearch(searchStr: string): Record<string, unknown> {
  const raw = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  const q = new URLSearchParams(raw);
  const out: Record<string, unknown> = {};
  for (const [key, value] of q) out[key] = value;
  return out;
}

function stringifySearch(search: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => <p>Not found</p>,
    parseSearch,
    stringifySearch,
  });
}
