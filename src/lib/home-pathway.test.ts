import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-10 homepage cleanup ("follow your recommendations"): five sections, one path down
// the page; the Pathway, app, megaprojects and extra links moved to their pages and the footer.
const page = readFileSync("src/routes/index.tsx", "utf8");
const at = (s: string) => page.indexOf(s);

test("the homepage is five sections in this order: search, message, AI proof, $5 pass, state map", () => {
  const order = ["<HomeContractFinder", "<HomeExecutionLine />", "<HomeMaxProof />", "<StarterPassStrip />", "<HomeStateMap"].map(at);
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("moved off the homepage: the Pathway steps, the app panel, megaprojects, the subs card and the tool links", () => {
  for (const gone of ["<HomePathway />", "<HomeAppStrip />", "<HomeMegaprojects", "<HomeSubsJoin />", "PATHWAY_STEPS.map(", 'trackEvent("home_open_to_all_click")'])
    expect(page).not.toContain(gone);
});

test("the Tampa card shows to everyone, right after the message: out-of-state crews need the housing (owner 2026-11-10)", () => {
  expect(page).not.toContain("FloridaOnly");
  const tampa = at("<HomeTampaPartner />");
  expect(tampa).toBeGreaterThan(at("<HomeExecutionLine />"));
  expect(tampa).toBeLessThan(at("<HomeMaxProof />"));
  expect(page).toContain('{ href: "/tampa-contractors", label: "Tampa: work and crew housing" }');
});

test("subs are folded into the message section, and the footer keeps every moved tool", () => {
  const line = page.slice(at("function HomeExecutionLine"), at("function HomeTampaPartner"));
  expect(line).toContain('href="/sub-finder/join?source=home"');
  expect(line).toContain('href="/subs-wanted"');
  for (const href of ['"/pathway"', '"/gap-map"', '"/roadmap"', '"/prime-finder"', '"/recompetes"', '"/megaprojects"', '"/subs-wanted"', '"/co-op-contracts"'])
    expect(page).toContain(`href: ${href}`);
});

test("the $5 strip still says what the 6 AM email brings", () => {
  expect(page).toContain("Auto-Pilot reads each one against your business and leads with the best fits");
});

test("megaprojects stay one tap away from a thin Radar search", () => {
  expect(readFileSync("src/routes/radar.tsx", "utf8")).toContain('href="/megaprojects?source=radar_more"');
});
