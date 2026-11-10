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

test("quotes carry an optional, self-reported license number and state (owner 2026-11-10)", async () => {
  const { cleanResponseInput, responseEmail } = await import("~/lib/sub-finder");
  const base = { company: "Peach Air LLC", email: "quotes@peachair.example", licenseNumber: "CR123456", licenseState: "ga" };
  const r = cleanResponseInput(base);
  expect(r.ok && r.input.licenseNumber).toBe("CR123456");
  expect(r.ok && r.input.licenseState).toBe("GA");
  expect(cleanResponseInput({ ...base, licenseNumber: "<script>" }).ok).toBe(false);
  const none = cleanResponseInput({ company: "Peach Air LLC", email: "quotes@peachair.example" });
  expect(none.ok && none.input.licenseNumber).toBe("");
  if (r.ok) expect(responseEmail({ title: "HVAC work in Atlanta", trade: "HVAC and plumbing", url: "https://x" }, r.input).text).toContain("License (self-reported): GA CR123456");
  if (none.ok) expect(responseEmail({ title: "t", trade: "t", url: "https://x" }, none.input).text).toContain("License: not given");
  expect(read("../routes/trade-package.$slug.tsx")).toContain('name="licenseNumber"');
  expect(read("./sub-finder.server.ts")).toContain("license_number, license_state, message, created_at FROM trade_package_responses");
});

test("the boards are reachable on phones too: homepage footer, homepage subs card and Sub Finder (owner 2026-11-10)", () => {
  const home = read("../routes/index.tsx");
  expect(home).toContain('{ href: "/subs-wanted", label: "Subs Wanted" }');
  expect(home).toContain('{ href: "/co-op-contracts", label: "Co-op contracts" }');
  expect(home).toContain("See public or private jobs that need subs →");
  expect(read("../routes/sub-finder.tsx")).toContain("Subs Wanted board: public or private jobs that need subs now →");
  expect(read("../routes/subs-wanted.tsx")).toContain("Public or private");
});
