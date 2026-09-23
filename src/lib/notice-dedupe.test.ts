/**
 * FIX ① REGRESSION PINS — Radar's read-time solicitation dedupe key must carry
 * `notice_type`, so an Award Notice and a Justification filed under ONE
 * solicitation number stay two matches (owner-locked nationwide correctness fix,
 * 2026-09-23; audit finding F-4 / live case 139010 vs 139012).
 *
 * DETERMINISTIC BY CONSTRUCTION: zero network, zero database. Every row the
 * tests read is a verbatim copy of a real stored production row, committed as
 * `fixtures/notice-dedupe/amendment-pairs.json`, and the extra read the Radar
 * route performs is injected as a stub loader — the same seam the production
 * route uses (`collapseScanRows(rows, (ids) => loadNoticeDedupeKeys(sql, ids))`).
 *
 * WHY IT MATTERS (product surface): today the key is `sol:<solicitation_number>`,
 * so each pair below collapses into ONE Radar match and the second public notice
 * is unreachable — the ≤5 default-match cap is then spent on a duplicate. The
 * stored side already keeps them apart (migration 048's partial UNIQUE natural
 * key includes `COALESCE(notice_type,'')`), so the read path was the only place
 * the amendment dimension was lost.
 *
 * WHAT THIS FILE PINS
 *   (a) same solicitation number + DIFFERENT notice_type ⇒ BOTH survive;
 *   (b) same solicitation number + SAME notice_type      ⇒ collapse to one;
 *   (c) the same two directions on the natural-key fallback (no solicitation
 *       number), which must match the 5-dim stored semantics;
 *   (d) a NULL / missing notice_type is ONE key value, never a wildcard;
 *   (e) the collapse still collapses genuine cross-source duplicates (the QA F2
 *       regression) and still degrades FAIL-SOFT to the natural key when the
 *       notice-key columns are unreadable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { collapseDuplicateNotices, noticeDedupeKey, type NoticeKeyRow } from "~/lib/notice-dedupe";
import { collapseScanRows } from "~/lib/radar-scan-query";

interface FixtureRow extends NoticeKeyRow {
  id: number;
  source: string;
  title: string;
  agency: string;
  psc?: string | null;
  due_date?: string | null;
}

interface FixturePair {
  label: string;
  solicitation_number: string;
  title: string;
  agency: string;
  rows: FixtureRow[];
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/notice-dedupe/amendment-pairs.json", import.meta.url), "utf8"),
) as { capturedAt: string; pairs: FixturePair[] };

/** The Radar route's production loader shape, stubbed with zero I/O. */
function stubLoader(
  rows: readonly FixtureRow[],
): (ids: number[]) => Promise<Map<number, { solicitation_number: string | null; notice_type: string | null }>> {
  return async (ids) =>
    new Map(
      rows
        .filter((r) => ids.includes(r.id))
        .map((r) => [
          r.id,
          { solicitation_number: r.solicitation_number ?? null, notice_type: r.notice_type ?? null },
        ]),
    );
}

describe("FIX ① — fixture sanity (real production rows, not synthesised)", () => {
  test("four captured amendment pairs, each with two rows differing only in notice_type", () => {
    expect(FIXTURE.capturedAt).toBe("2026-09-23");
    expect(FIXTURE.pairs.length).toBe(4);
    for (const pair of FIXTURE.pairs) {
      expect(pair.rows.length).toBe(2);
      expect(pair.rows[0]!.notice_type).not.toBe(pair.rows[1]!.notice_type);
      // …and they really are the same solicitation, title and agency.
      expect(pair.rows[0]!.solicitation_number).toBe(pair.rows[1]!.solicitation_number);
      expect(pair.rows[0]!.title).toBe(pair.rows[1]!.title);
      expect(pair.rows[0]!.agency).toBe(pair.rows[1]!.agency);
    }
    // The audit's live case is the Award-vs-Justification pair.
    const auditPair = FIXTURE.pairs[0]!;
    expect(auditPair.solicitation_number).toBe("140FS126P0240");
    expect(auditPair.rows.map((r) => r.notice_type)).toEqual(["Award Notice", "Justification"]);
  });
});

describe("FIX ① (a) — same solicitation number, DIFFERENT notice_type ⇒ both stay separate", () => {
  test("each real amendment pair yields TWO distinct keys", () => {
    for (const pair of FIXTURE.pairs) {
      const [a, b] = pair.rows as [FixtureRow, FixtureRow];
      expect(noticeDedupeKey(a)).not.toBe(noticeDedupeKey(b));
      // Both keys are still keyed by the SAME solicitation (the dimension that
      // was added is notice_type, not the solicitation number).
      expect(noticeDedupeKey(a)).toContain(a.solicitation_number!.toLowerCase());
      expect(noticeDedupeKey(a)).toContain("nt:");
      const { rows: kept, collapsed } = collapseDuplicateNotices(pair.rows);
      expect(kept.length).toBe(2);
      expect(collapsed).toBe(0);
      expect(kept.map((r) => r.id)).toEqual([a.id, b.id]);
    }
  });

  test("the Award/Justification pair survives the Radar collapse (end-to-end through the stub loader)", async () => {
    const pair = FIXTURE.pairs[0]!;
    const out = await collapseScanRows(pair.rows, stubLoader(pair.rows));
    expect(out.rows.length).toBe(2);
    expect(out.collapsed).toBe(0);
    expect(out.noticeKeyColumns).toBe(true);
    expect(out.rows.map((r) => r.id)).toEqual([139010, 139012]);
  });

  test("ALL FOUR pairs survive one scan together (8 rows in, 8 distinct notices out)", async () => {
    const rows = FIXTURE.pairs.flatMap((p) => p.rows);
    expect(rows.length).toBe(8);
    const out = await collapseScanRows(rows, stubLoader(rows));
    expect(out.rows.length).toBe(8);
    expect(out.collapsed).toBe(0);
  });
});

describe("FIX ① (b) — same solicitation number AND same notice_type ⇒ still dedupes to one", () => {
  test("a re-ingested notice under another source label collapses (QA F2 behaviour kept)", () => {
    const rows: NoticeKeyRow[] = [
      { solicitation_number: "140FS126P0240", notice_type: "Award Notice", title: "T", agency: "A" },
      { solicitation_number: "140fs126p0240", notice_type: "award notice ", title: "T", agency: "A" },
      { solicitation_number: "140FS126P0240", notice_type: "Justification", title: "T", agency: "A" },
    ];
    const { rows: kept, collapsed } = collapseDuplicateNotices(rows);
    // Two Award Notices (case/whitespace-insensitively equal) collapse; the
    // Justification stays.
    expect(kept.length).toBe(2);
    expect(collapsed).toBe(1);
    expect(noticeDedupeKey(rows[0]!)).toBe(noticeDedupeKey(rows[1]!));
    expect(noticeDedupeKey(rows[0]!)).not.toBe(noticeDedupeKey(rows[2]!));
  });

  test("through the Radar collapse: the same notice from three state-door labels is one match", async () => {
    const rows = [
      { id: 1, title: "Janitorial Services", agency: "DLA", solicitation_number: "W912C326BA003", notice_type: "Solicitation" },
      { id: 2, title: "Janitorial Services", agency: "DLA", solicitation_number: "w912c326ba003", notice_type: "Solicitation" },
      { id: 3, title: "Janitorial Services", agency: "DLA", solicitation_number: "W912C326BA003", notice_type: "Solicitation" },
    ];
    const out = await collapseScanRows(rows, stubLoader(rows as unknown as FixtureRow[]));
    expect(out.rows.length).toBe(1);
    expect(out.collapsed).toBe(2);
    expect(out.rows[0]!.id).toBe(1);
  });
});

describe("FIX ① (c) — the natural-key fallback carries notice_type too (stored 5-dim parity)", () => {
  const base = { title: "F108--Mobile Firing Range Cleaning", agency: "NCO 17" };

  test("no solicitation number: same title+agency, DIFFERENT notice_type ⇒ separate", () => {
    const rows: NoticeKeyRow[] = [
      { ...base, notice_type: "Presolicitation" },
      { ...base, notice_type: "Solicitation" },
    ];
    expect(noticeDedupeKey(rows[0]!)).not.toBe(noticeDedupeKey(rows[1]!));
    const { rows: kept } = collapseDuplicateNotices(rows);
    expect(kept.length).toBe(2);
  });

  test("no solicitation number: same title+agency AND same notice_type ⇒ one", () => {
    const rows: NoticeKeyRow[] = [
      { ...base, notice_type: "Solicitation" },
      { ...base, notice_type: "solicitation" },
      { ...base, notice_type: null },
    ];
    const { rows: kept, collapsed } = collapseDuplicateNotices(rows);
    // The two "Solicitation" rows collapse; the NULL-notice-type row is a
    // DIFFERENT key value (never a wildcard) and therefore stays.
    expect(kept.length).toBe(2);
    expect(collapsed).toBe(1);
  });

  test("the production duplicate-title fixture still collapses (no re-inflation)", () => {
    // Regression guard: widening the key must not un-collapse the 3,652
    // title-group duplicates the R5 dedupe exists for. Those rows carry no
    // notice_type at all, so their keys are unchanged.
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/notice-dedupe/duplicate-title-groups.json", import.meta.url), "utf8"),
    ) as { rows: { source: string; title: string; agency: string | null }[] };
    const { rows: kept, collapsed } = collapseDuplicateNotices(fixture.rows);
    expect(collapsed).toBeGreaterThan(10);
    expect(kept.map((r) => noticeDedupeKey(r))).toEqual([...new Set(kept.map((r) => noticeDedupeKey(r)))]);
  });
});

describe("FIX ① (d)/(e) — NULL notice_type is one value, never a wildcard; fail-soft intact", () => {
  test("missing / null / empty notice_type all normalize to the same key", () => {
    const withNull = { title: "T", agency: "A", solicitation_number: "S1", notice_type: null };
    const withUndefined = { title: "T", agency: "A", solicitation_number: "S1" };
    const withEmpty = { title: "T", agency: "A", solicitation_number: "S1", notice_type: "   " };
    expect(noticeDedupeKey(withNull)).toBe(noticeDedupeKey(withUndefined));
    expect(noticeDedupeKey(withNull)).toBe(noticeDedupeKey(withEmpty));
    // …and it is NOT treated as "matches anything": a typed row is a different key.
    expect(noticeDedupeKey(withNull)).not.toBe(
      noticeDedupeKey({ ...withNull, notice_type: "Award Notice" }),
    );
  });

  test("an unreadable notice-key read degrades to the natural key and never fails the scan", async () => {
    const rows = FIXTURE.pairs[0]!.rows; // same title+agency, Award vs Justification
    const out = await collapseScanRows(rows, async () => {
      throw new Error('column "notice_type" does not exist');
    });
    expect(out.noticeKeyColumns).toBe(false);
    // Without the columns the pair still collapses on (title, agency) — the
    // pre-FIX ① behaviour, exactly the fail-soft contract.
    expect(out.rows.length).toBe(1);
    expect(out.rows[0]!.id).toBe(139010);
  });
});

describe("FIX ① — the key is genuinely two-dimensional", () => {
  test("notice_type alone distinguishes; removing it changes the key", () => {
    const award: NoticeKeyRow = {
      solicitation_number: "140FS126P0240",
      notice_type: "Award Notice",
      title: "W--WA-LEAVENWORTH NFH-FISH TRANSPORTATION",
      agency: "FWS, SAT TEAM 1",
    };
    const justification: NoticeKeyRow = { ...award, notice_type: "Justification" };
    expect(noticeDedupeKey(award)).toBe("sol:140fs126p0240|nt:award notice");
    expect(noticeDedupeKey(justification)).toBe("sol:140fs126p0240|nt:justification");
    // The pre-FIX ① key (solicitation number only) would have collapsed them.
    expect(noticeDedupeKey(award).replace(/\|nt:.*$/, "")).toBe(
      noticeDedupeKey(justification).replace(/\|nt:.*$/, ""),
    );
  });

  test("a different solicitation number is still a separate notice regardless of notice_type", () => {
    const a: NoticeKeyRow = { solicitation_number: "S1", notice_type: "Award Notice", title: "T", agency: "A" };
    const b: NoticeKeyRow = { ...a, solicitation_number: "S2" };
    expect(noticeDedupeKey(a)).not.toBe(noticeDedupeKey(b));
    expect(collapseDuplicateNotices([a, b]).rows.length).toBe(2);
  });
});
