/**
 * Hauling leads — the sync's placeholder write gate, exercised through the REAL job path
 * (`syncHaulingLeads`) with a STUBBED fetch and a DRY RUN.
 *
 * DETERMINISTIC, zero network, no DATABASE_URL: `dryRun` skips the schema check and the
 * insert, so `~/db`'s `sql()` is never called and nothing is written. The rows come from
 * the committed capture (src/lib/fixtures/hauling-leads/lexicon-slice.json), so this
 * suite pins what the running sync will store without touching USAspending or Postgres.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HAULING_KEYWORDS, isStorableHaulingLead, toHaulingLead } from "~/lib/hauling-leads";
import { syncHaulingLeads } from "~/lib/hauling-leads.server";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/hauling-leads/lexicon-slice.json", import.meta.url), "utf8"),
) as { rows: Record<string, unknown>[] };

/** The live 30-day window the sync runs with, pinned to the capture's own date. */
const NOW = new Date("2026-10-16T12:00:00Z");
const WINDOW_START = "2026-09-16";

/** The captured rows a real run of this window would be offered. */
const inWindow = FIXTURE.rows.filter((r) => toHaulingLead(r, { windowStart: WINDOW_START }) !== null);

/** A fetch stub that answers page 1 with the captured rows and stops. */
function stubFetch(): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ results: inWindow, page_metadata: { hasNext: false } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe("the sync's write gate drops placeholder-named leads", () => {
  test("the captured window really does contain one placeholder row (the regression this pins)", () => {
    expect(inWindow.length).toBeGreaterThan(1);
    const placeholderRows = inWindow.filter((r) => String(r["Recipient Name"]) === "MISCELLANEOUS FOREIGN AWARDEES");
    expect(placeholderRows.length).toBe(1);
    expect(String(placeholderRows[0]!["Award ID"])).toBe("19RS5026F0169");
  });

  test("definition R is reported unchanged, and the placeholder row is not in what the sync stores", async () => {
    const { fetchImpl, bodies } = stubFetch();
    const r = await syncHaulingLeads({ dryRun: true, now: NOW, fetchImpl });

    expect(r.windowStart).toBe(WINDOW_START);
    expect(r.windowEnd).toBe("2026-10-16");
    expect(r.seen).toBe(inWindow.length);
    // `kept` is definition R — the measured set, placeholder included.
    expect(r.kept).toBe(inWindow.length);
    expect(r.placeholderSkipped).toBe(1);
    // `leads` is what the sync keeps/stores: R minus the placeholder row.
    expect(r.leads.length).toBe(inWindow.length - 1);
    expect(r.leads.every(isStorableHaulingLead)).toBe(true);
    expect(r.leads.some((l) => l.prime_name === "MISCELLANEOUS FOREIGN AWARDEES")).toBe(false);
    expect(r.leads.some((l) => l.award_id === "19RS5026F0169")).toBe(false);
    expect(r.inserted).toBe(0); // dry run writes nothing

    // The request itself is untouched by this guard.
    expect(bodies.length).toBe(1);
    const filters = bodies[0]!.filters as Record<string, unknown>;
    expect(filters.keywords).toEqual([...HAULING_KEYWORDS]);
    expect(bodies[0]!.page).toBe(1);
  });

  test("the per-run mix is computed over what is stored (the placeholder row is not counted)", async () => {
    const { fetchImpl } = stubFetch();
    const r = await syncHaulingLeads({ dryRun: true, now: NOW, fetchImpl });
    const total = Object.values(r.byScopeKind).reduce((a, b) => a + b, 0);
    expect(total).toBe(r.leads.length);
    expect(Object.values(r.byPrimeKind).reduce((a, b) => a + b, 0)).toBe(r.leads.length);
  });
});
