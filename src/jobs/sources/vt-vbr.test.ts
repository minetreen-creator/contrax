/**
 * Vermont Business Registry and Bid System (`vt_vbr`) connector pins. Zero
 * network, no database: the fixtures are the open state and municipal bid
 * lists and every bid's detail page, captured 2026-10-02 (see
 * fixtures/vt-vbr/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { parseVbrBids, readVbrDetail, readVbrList, vbrDateToIso, vbrListHasMorePages, type VbrDetail } from "./vt-vbr";

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/vt-vbr/${name}`, import.meta.url))).toString("utf8")) as Record<string, string>;
const LISTS = gz("lists-2026-10-02.json.gz");
const PAGES = gz("bid-details-2026-10-02.json.gz");
const LIST = [...readVbrList(LISTS["5"]!, "state"), ...readVbrList(LISTS["7"]!, "municipal")];
const DETAILS: Record<string, VbrDetail> = Object.fromEntries(Object.entries(PAGES).map(([id, html]) => [id, readVbrDetail(html)]));
const CAPTURED = Date.parse("2026-10-02T03:41:00Z");

describe("vt_vbr — lists", () => {
  test("44 state and 35 municipal bids, one page each", () => {
    expect(readVbrList(LISTS["5"]!, "state").length).toBe(44);
    expect(readVbrList(LISTS["7"]!, "municipal").length).toBe(35);
    expect(vbrListHasMorePages(LISTS["5"]!)).toBe(false);
    expect(vbrListHasMorePages(LISTS["7"]!)).toBe(false);
    expect(vbrListHasMorePages(`<a href="javascript:__doPostBack(&#39;gvResults&#39;,&#39;Page$2&#39;)">2</a>`)).toBe(true);
  });
});

describe("vt_vbr — parse (captured pages)", () => {
  test("61 open bids become Vermont bids; 18 stale listings are closed", () => {
    const { rows, skipped } = parseVbrBids(LIST, DETAILS, CAPTURED);
    expect(skipped).toEqual({ closed: 18 });
    expect(rows.length).toBe(61);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^vtvbr-\d+$/);
      expect(r.source_url).toBe(`https://www.vermontbusinessregistry.com/BidPreview.aspx?BidID=${r.external_id.slice(6)}`);
      expect(r.location).toBe("Vermont");
      expect(r.description).not.toMatch(/\w@\w/);
      expect(r.description.toLowerCase()).not.toContain(r.agency.toLowerCase());
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "vt_vbr" });
      expect(cols.source_jurisdiction).toBe("VT");
      expect(cols.normalized_state).toBe("VT");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the DAIL shelter NOFO maps field by field", () => {
    const row = parseVbrBids(LIST, DETAILS, CAPTURED).rows.find((r) => r.external_id === "vtvbr-76197")!;
    expect(row.title).toBe("Specialized Emergency Shelter for Medically Vulnerable Vermonters");
    expect(row.agency).toBe("Dept. of Disabilities, Aging & Independent Living");
    expect(row.due_date).toBe("2026-11-02T21:00:00.000Z"); // 4:00 PM EST
    expect(row.estimated_value).toBe("$1,801,500.00");
    expect(row.notice_type).toBe("Request for Proposal");
    expect(row.description).toContain("Work location: State-Wide (Vermont).");
  });

  test("a $0.00 estimate is 'Not specified'; without a detail page the list fields still make a bid", () => {
    const zero = Object.entries(DETAILS).find(([id, d]) => d.estValue === "$0.00" && parseVbrBids(LIST, DETAILS, CAPTURED).rows.some((r) => r.external_id === `vtvbr-${id}`))!;
    const withDetail = parseVbrBids(LIST, DETAILS, CAPTURED).rows.find((r) => r.external_id === `vtvbr-${zero[0]}`)!;
    expect(withDetail.estimated_value).toBe("Not specified");
    const rows = parseVbrBids(LIST, {}, CAPTURED).rows;
    expect(rows.length).toBe(61);
    const municipal = LIST.find((b) => b.kind === "municipal" && rows.some((r) => r.external_id === `vtvbr-${b.id}`))!;
    const bare = rows.find((r) => r.external_id === `vtvbr-${municipal.id}`)!;
    expect(bare.title).toBe(municipal.title);
    expect(bare.agency).toBe(municipal.author);
    expect(bare.solicitation_number).toBe(municipal.id);
    expect(bare.description).toBe("Posted on the Vermont Business Registry and Bid System as a municipal bid.");
  });

  test("dates", () => {
    expect(vbrDateToIso("11/20/2026 4:30:00 PM")).toBe("2026-11-20T21:30:00.000Z");
    expect(vbrDateToIso("10/30/2026 1:00 PM")).toBe("2026-10-30T17:00:00.000Z");
    expect(vbrDateToIso("")).toBeNull();
  });
});

describe("vt_vbr — registration", () => {
  test("registered as a tail sync source, Vermont home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "vt_vbr")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["vt_vbr"]).toBe("VT");
    expect(isStateLocalSource(["vt_vbr"])).toBe(true);
    expect(sourceBadgeLabel("vt_vbr")).toBe("State (VT)");
  });
});
