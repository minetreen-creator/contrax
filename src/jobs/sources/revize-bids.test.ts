import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { fetchRevizeBoard, parseRevizeBids, REVIZE_BOARDS, revizeClosing, revizeDeps } from "./revize-bids";

// Owner 2026-11-07: "Yes do Pennsylvania, Virginia and Ohio". One reader for Revize "Bid Postings" boards.
const fx = (f: string) => readFileSync(new URL(`./fixtures/revize/${f}`, import.meta.url), "utf8");
const now = Date.parse("2026-11-07T05:00:00Z");
const [butler, lackawanna, smyrna] = REVIZE_BOARDS;

test("Butler County, OH: the open water main rehabilitation, Eastern closing time", () => {
  const { rows, skipped } = parseRevizeBids(butler, fx("butler-county-oh-2026-11-07.html"), now);
  expect(skipped).toEqual({});
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("Symmes Road 42 – Inch Transmission Main Rehabilitation");
  expect(rows[0].solicitation_number).toBe("BCWS-2026-10-01");
  expect(rows[0].due_date).toBe("2026-11-20T19:00:00.000Z"); // 2:00 PM EST
  expect(rows[0].category).toBe("Construction");
  expect(rows[0].source_url).toBe("https://www.bcohio.gov/bid_detail_T3_R286.php");
});

test("Lackawanna County, PA: old postings on the page are skipped as closed", () => {
  const { rows, skipped } = parseRevizeBids(lackawanna, fx("lackawanna-county-pa-2026-11-07.html"), now);
  expect(rows.map((r) => r.title)).toEqual(["RFQ Lackawanna County Wireless Network"]);
  expect(skipped.closed).toBe(147);
  expect(rows[0].source_url).toStartWith("https://lackawannacounty.org/government/departments/bid_detail_");
});

test("Smyrna, TN: an empty board reads as zero, not an error", () => {
  expect(parseRevizeBids(smyrna, fx("smyrna-tn-2026-11-06.html"), now).rows).toHaveLength(0);
  expect(() => parseRevizeBids(smyrna, "<html>moved</html>", now)).toThrow();
});

test("closing text: timed, date-only and Central boards", () => {
  expect(revizeClosing("November 20, 2026 2:00 PM", "America/New_York")).toEqual({ iso: "2026-11-20T19:00:00.000Z", timed: true });
  expect(revizeClosing("July 1, 2026", "America/Chicago")).toEqual({ iso: "2026-07-02T04:59:00.000Z", timed: false });
  expect(revizeClosing("soon", "America/Chicago")).toBeNull();
});

test("reader fails loudly on HTTP errors; boards are scheduled, local, in their states", async () => {
  const saved = { ...revizeDeps };
  try {
    revizeDeps.fetch = async () => new Response("no", { status: 500 });
    await expect(fetchRevizeBoard(butler, now)).rejects.toThrow();
  } finally { Object.assign(revizeDeps, saved); }
  for (const b of REVIZE_BOARDS) {
    expect(TAIL_SOURCES.some((t) => t.name === b.source)).toBe(true);
    expect(SOURCE_CLASSES[b.source]?.class).toBe("local");
    expect(SOURCE_HOME_JURISDICTIONS[b.source]).toBe(b.location.slice(-2));
    expect(LOCAL_AGENCIES.some((a) => a.source === b.source)).toBe(true);
  }
});
