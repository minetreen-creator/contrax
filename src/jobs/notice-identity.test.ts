/**
 * Run-level notice-identity guard — nationwide correctness FIX ⑤ step B.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE: this file exercises the pure guard
 * module only (src/jobs/notice-identity.ts) plus two REAL committed SAM.gov
 * fixtures, and injects the detail fetcher wherever `mapSamItem` needs one.
 *
 * What the pins defend (readiness §4 items 3, 6 and 9):
 *   - first claim wins, later copies of the same notice id are suppressed with
 *     the VISIBLE reason `duplicate_notice` (never a silent drop);
 *   - the accounting the runner writes still satisfies
 *     `fetched = rows + skipped` (⇒ `fetched = accepted + skipped + failed`);
 *   - a row with no identity (a non-SAM source) is NEVER suppressed;
 *   - the key is the NOTICE ID, not (title, agency): the live R602 award family
 *     (same title, same agency, different `_id`) must BOTH survive — the same
 *     anti-collapse rule fix ① and migration 048's 5-dimension key enforce;
 *   - Phase 1 runs first, so a metadata-rich trade-pass row keeps its notice and
 *     the later metadata-poor door row is the one suppressed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyNoticeIdentityGuard,
  applyRunNoticeGuard,
  createNoticeIdentityGuard,
  DUPLICATE_NOTICE_REASON,
  normalizeNoticeKey,
  NoticeIdentityGuard,
} from "./notice-identity";
import {
  canonicalNoticeId,
  mapSamItem,
  type OpportunityDetail,
  type RawBid,
} from "./sources/sam-gov";

const EMPTY_DETAIL: OpportunityDetail = {
  setAside: null,
  naicsCode: null,
  psc: null,
  noticeType: null,
  solicitationNumber: null,
};

function row(noticeKey: string | null | undefined, source = "fake"): RawBid {
  return {
    external_id: `sam-${noticeKey ?? "none"}`,
    title: "Some Notice",
    agency: "Some Agency",
    description: "d",
    location: "Unknown",
    category: "services",
    due_date: null,
    estimated_value: "Not specified",
    source_url: "https://sam.gov/search/",
    source_label: source,
    notice_key: noticeKey,
  };
}

function batch(rows: RawBid[], skipped: Record<string, number> = {}) {
  return { rows, skipped, skippedRows: [] as { id: string; reason: string }[] };
}

describe("NoticeIdentityGuard", () => {
  test("first claim wins; an identity already accepted later in the run is refused", () => {
    const guard = new NoticeIdentityGuard();
    expect(guard.claim("abc")).toBe(true);
    expect(guard.claim("abc")).toBe(false);
    expect(guard.claim("  abc  ")).toBe(false); // trimmed — the same identity
    expect(guard.claim("def")).toBe(true);
    expect(guard.acceptedCount).toBe(2);
    expect(guard.has("abc")).toBe(true);
    expect(guard.has("zzz")).toBe(false);
  });

  test("an absent identity is never claimed and never suppressed", () => {
    const guard = createNoticeIdentityGuard();
    expect(guard.claim(null)).toBe(true);
    expect(guard.claim(undefined)).toBe(true);
    expect(guard.claim("")).toBe(true);
    expect(guard.claim("   ")).toBe(true);
    expect(guard.acceptedCount).toBe(0);
    expect(normalizeNoticeKey(null)).toBeNull();
    expect(normalizeNoticeKey(" x ")).toBe("x");
  });
});

describe("applyNoticeIdentityGuard", () => {
  test("splits kept/skipped deterministically, preserves order, never mutates its input", () => {
    const rows = [row("a"), row("b"), row("a"), row(null), row("b"), row("c")];
    const snapshot = JSON.parse(JSON.stringify(rows));
    const guard = createNoticeIdentityGuard();
    const { kept, skipped } = applyNoticeIdentityGuard(rows, guard);

    expect(kept.map((r) => r.notice_key)).toEqual(["a", "b", null, "c"]);
    expect(skipped).toEqual([
      { id: "a", reason: "duplicate_notice" },
      { id: "b", reason: "duplicate_notice" },
    ]);
    expect(rows.length).toBe(kept.length + skipped.length);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(snapshot);

    // deterministic: the same input on a fresh guard gives the same split
    const again = applyNoticeIdentityGuard(rows, createNoticeIdentityGuard());
    expect(again.kept.map((r) => r.notice_key)).toEqual(["a", "b", null, "c"]);
  });

  test("two fake fetches sharing one run guard keep ONE row for a repeated notice", () => {
    const guard = createNoticeIdentityGuard();
    const sourceA = applyNoticeIdentityGuard([row("n1", "fl"), row("n2", "fl")], guard);
    const sourceB = applyNoticeIdentityGuard([row("n1", "va"), row("n2", "va")], guard);
    expect(sourceA.kept.map((r) => r.notice_key)).toEqual(["n1", "n2"]);
    expect(sourceB.kept).toHaveLength(0);
    expect(sourceB.skipped).toEqual([
      { id: "n1", reason: DUPLICATE_NOTICE_REASON },
      { id: "n2", reason: DUPLICATE_NOTICE_REASON },
    ]);
  });
});

describe("applyRunNoticeGuard (the runner's accounting)", () => {
  test("merges the source's own skip reasons with the guard's and keeps fetched = rows + skipped", () => {
    const guard = createNoticeIdentityGuard();
    // First source claims both notices.
    const first = applyRunNoticeGuard(batch([row("n1", "sam_gov"), row("n2", "sam_gov")]), guard);
    expect(first.rows).toHaveLength(2);
    expect(first.skippedCount).toBe(0);
    expect(first.fetchedCount).toBe(2);

    // Second source: its own gate already skipped two rows, and the guard
    // suppresses its copy of n1 — both must stay visible.
    const second = applyRunNoticeGuard(
      { rows: [row("n1", "fl"), row("n3", "fl")], skipped: { product_buy: 2 }, skippedRows: [{ id: "x", reason: "product_buy" }] },
      guard,
    );
    expect(second.rows.map((r) => r.notice_key)).toEqual(["n3"]);
    expect(second.skipped).toEqual({ product_buy: 2, duplicate_notice: 1 });
    expect(second.skippedRows).toEqual([
      { id: "x", reason: "product_buy" },
      { id: "n1", reason: "duplicate_notice" },
    ]);
    expect(second.skippedCount).toBe(3);
    expect(second.fetchedCount).toBe(4); // 1 kept + 3 deliberate skips
    expect(second.fetchedCount).toBe(second.rows.length + second.skippedCount);
  });

  test("with no guard (a non-SAM source) the batch is a pass-through", () => {
    const rows = [row(undefined, "oh_dayton"), row(null, "pennbid")];
    const out = applyRunNoticeGuard(batch(rows, { closed: 1 }), undefined);
    expect(out.rows).toHaveLength(2);
    expect(out.skipped).toEqual({ closed: 1 });
    expect(out.fetchedCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Real-fixture pins: identity is the NOTICE ID (not title+agency), and Phase 1
// (authoritative passes) always claims a notice before the Phase-2 doors.
// ---------------------------------------------------------------------------
const TRADES_DIR = new URL("./sources/fixtures/sam-trades/", import.meta.url);
const R602_PAGE = JSON.parse(readFileSync(new URL("psc-r602-page0.json", TRADES_DIR), "utf8"));
const DOORS_DIR = new URL("./sources/fixtures/state-keyword/", import.meta.url);
const FL_PAGE = JSON.parse(readFileSync(new URL("doors-florida-page0.json", DOORS_DIR), "utf8"));
const DETAIL_MULTISTATE = JSON.parse(readFileSync(new URL("detail-multistate.json", DOORS_DIR), "utf8"));

const noDetail = async (_noticeId: string): Promise<OpportunityDetail> => ({ ...EMPTY_DETAIL });

describe("real fixtures — anti-collapse and attribution order", () => {
  test("a live notice family with the SAME title+agency but different _id is NOT collapsed", async () => {
    const items = R602_PAGE._embedded.results as any[];
    const awardFamily = items.filter((i) => (i.type?.value ?? "") === "Award Notice");
    expect(awardFamily.length).toBe(2); // the real TransMedics pair, same title
    const mapped = await Promise.all(
      awardFamily.map((item) =>
        mapSamItem(item, { sourceLabel: "sam_psc_r602", filterPsc: "R602", detailFetcher: noDetail, detailDelay: false }),
      ),
    );
    // the trap the key must not fall into
    expect(mapped[0].title).toBe(mapped[1].title);
    expect(mapped[0].agency).toBe(mapped[1].agency);
    expect(mapped[0].external_id).not.toBe(mapped[1].external_id);

    const guard = createNoticeIdentityGuard();
    const { kept, skipped } = applyNoticeIdentityGuard(mapped, guard);
    expect(skipped).toHaveLength(0);
    expect(kept.map((r) => r.external_id)).toEqual(mapped.map((r) => r.external_id));
    expect(guard.acceptedCount).toBe(2);
  });

  test("Phase 1 (a trade pass) keeps its row; the later door's copy is the suppressed one", async () => {
    const item = FL_PAGE._embedded.results.find((i: any) => i._id === "5c1e0f7a2d8b4a1e9f3c6b0d847a2e51");
    expect(canonicalNoticeId(item)).toBe("5c1e0f7a2d8b4a1e9f3c6b0d847a2e51");

    const tradeRow = await mapSamItem(item, {
      sourceLabel: "sam_psc_s201",
      filterPsc: "S201",
      detailFetcher: noDetail,
      detailDelay: false,
    });
    expect(tradeRow.psc).toBe("S201"); // authoritative metadata from the pass itself
    expect(tradeRow.notice_key).toBe("5c1e0f7a2d8b4a1e9f3c6b0d847a2e51");

    // The door row for the SAME notice — built exactly like state-keyword.ts
    // builds it (canonical identity + no PSC of its own).
    const doorRow: RawBid = {
      ...row("5c1e0f7a2d8b4a1e9f3c6b0d847a2e51", "fl"),
      external_id: "sam-5c1e0f7a2d8b4a1e9f3c6b0d847a2e51",
      title: item.title,
      agency: "N40085 NAVFAC MID-ATLANTIC",
      psc: DETAIL_MULTISTATE.data2.classificationCode,
    };

    const guard = createNoticeIdentityGuard();
    const phase1 = applyRunNoticeGuard(batch([tradeRow]), guard);
    const phase2 = applyRunNoticeGuard(batch([doorRow]), guard);
    expect(phase1.rows.map((r) => r.source_label)).toEqual(["sam_psc_s201"]);
    expect(phase1.skippedCount).toBe(0);
    expect(phase2.rows).toHaveLength(0);
    expect(phase2.skipped).toEqual({ duplicate_notice: 1 });
    expect(phase2.fetchedCount).toBe(1);
  });
});
