import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanPackageInput } from "~/lib/sub-finder";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const base = { trade: "HVAC and plumbing", state: "GA", location: "Atlanta", scope: "Licensed HVAC sub for new residential construction.", company: "Example Builders" };

test("posting to the Subs Wanted board is opt-in and needs a state (owner 2026-11-10)", () => {
  const off = cleanPackageInput(base, "2026-11-10");
  expect(off.ok && off.input.listOnBoard).toBe(false);
  const on = cleanPackageInput({ ...base, listOnBoard: true }, "2026-11-10");
  expect(on.ok && on.input.listOnBoard).toBe(true);
  const noState = cleanPackageInput({ ...base, state: "", listOnBoard: true }, "2026-11-10");
  expect(noState.ok).toBe(false);
});

test("the board shows only listed, still-open jobs, never contact details, and is linked from the menu, sitemap and join page", () => {
  const srv = read("./sub-finder.server.ts");
  expect(srv).toContain("WHERE on_board AND state IS NOT NULL AND (quotes_due IS NULL OR quotes_due >= CURRENT_DATE)");
  expect(srv).toContain("WHERE slug = ${slug} AND prime_user_id = ${userId}");
  const board = read("../routes/subs-wanted.tsx");
  expect(board).not.toMatch(/j\.(contact|email|phone)/);
  const job = srv.slice(srv.indexOf("export interface BoardJob"), srv.indexOf("}", srv.indexOf("export interface BoardJob")));
  expect(job).not.toMatch(/contact|email|phone/i);
  expect(board).toContain("Contrax doesn't verify companies, licenses or pay");
  expect(read("../components/SiteHeader.tsx")).toContain('href: "/subs-wanted"');
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/subs-wanted", "daily", "0.6"]');
  expect(read("../routes/sub-finder_.join.tsx")).toContain('href="/subs-wanted"');
  expect(read("../routes/sub-finder.tsx")).toContain('name="listOnBoard"');
});
