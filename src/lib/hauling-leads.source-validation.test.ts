/**
 * Hauling leads — LIVE source validation (trucking queue item #4).
 *
 * OPT-IN. This file does nothing unless HAULING_LEADS_RUN_LIVE_TESTS=1, so ordinary CI
 * never depends on a live external site:
 *
 *   HAULING_LEADS_RUN_LIVE_TESTS=1 bun test src/lib/hauling-leads.source-validation.test.ts
 *   bun run validate:live-hauling-leads            (the same thing, wired in package.json)
 *
 * What it proves: the REAL USAspending.gov endpoint still accepts this job's request
 * body (the 10-term keyword arm + new_awards_only + the $25k floor, with the fields the
 * mapper reads), the response parses, and every row the ladder keeps really satisfies
 * definition R and carries the stored evidence (id, date, winner, USAspending URL,
 * description snippet). It is read-only: no DATABASE_URL, no writes, no schema access.
 */
import { describe, expect, test } from "bun:test";
import {
  HAULING_LEAD_FIELDS,
  HAULING_LEAD_MIN_AMOUNT,
  buildHaulingSearchBody,
  descriptionHasHaulingScope,
  isCarrierNaics,
  isServiceNaics,
  naicsCode,
  toHaulingLead,
  windowStartFor,
  type HaulingLead,
} from "~/lib/hauling-leads";

const LIVE = process.env.HAULING_LEADS_RUN_LIVE_TESTS === "1";
const API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";

if (!LIVE) {
  console.log(
    "\n** HAULING LEADS LIVE SOURCE VALIDATION SKIPPED — run `bun run validate:live-hauling-leads` **\n",
  );
}

if (LIVE) {
  describe("USAspending.gov live (hauling leads)", () => {
    const now = new Date();
    const windowStart = windowStartFor(now);
    const windowEnd = now.toISOString().slice(0, 10);
    let rows: Record<string, unknown>[] = [];
    let status = 0;

    test("the live API still answers this job's request", async () => {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Contrax/1.0 (+https://www.contrax.company)",
        },
        body: JSON.stringify(buildHaulingSearchBody({ startDate: windowStart, endDate: windowEnd })),
        signal: AbortSignal.timeout(45_000),
      });
      status = res.status;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results?: Record<string, unknown>[] };
      rows = body.results ?? [];
      // The fields the mapper reads must be present on every returned row (a renamed
      // field would make the ladder read undefined and silently store nothing).
      for (const row of rows) {
        for (const field of HAULING_LEAD_FIELDS) {
          if (field === "Place of Performance City Name") continue; // measured 0/39 published
          expect(Object.prototype.hasOwnProperty.call(row, field)).toBe(true);
        }
      }
    });

    test("every row the ladder keeps satisfies definition R and carries its evidence", () => {
      const kept: HaulingLead[] = [];
      for (const row of rows) {
        const lead = toHaulingLead(row, { windowStart });
        if (lead) kept.push(lead);
      }
      for (const lead of kept) {
        const raw = rows.find((r) => r["generated_internal_id"] === lead.award_key)!;
        expect(lead.award_date! >= windowStart).toBe(true);
        expect(lead.amount).toBeGreaterThanOrEqual(HAULING_LEAD_MIN_AMOUNT);
        expect(isCarrierNaics(naicsCode(raw["NAICS"]))).toBe(false);
        expect(isServiceNaics(naicsCode(raw["NAICS"]))).toBe(true);
        expect(descriptionHasHaulingScope(raw["Description"])).toBe(true);
        expect(lead.usa_spending_url).toBe(
          `https://www.usaspending.gov/award/${encodeURIComponent(lead.award_key)}`,
        );
        expect(lead.prime_name.length).toBeGreaterThan(0);
        expect(lead.description_snippet.length).toBeGreaterThan(0);
      }
      console.log(
        `[hauling-leads live] window=${windowStart}..${windowEnd} status=${status} rows=${rows.length} kept=${kept.length}`,
      );
      for (const lead of kept) {
        console.log(
          `[hauling-leads live]   ${lead.award_date} | ${lead.pop_state ?? "--"} | ${lead.prime_name.slice(0, 34)} | $${lead.amount} | ${lead.scope_kind} | ${lead.prime_kind}`,
        );
      }
    });
  });
}
