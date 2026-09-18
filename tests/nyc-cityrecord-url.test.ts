/**
 * ── NEW (owner 09-18 follow-up to PR #397) ─────────────────────────────────
 * Root-cause pin for the dead "Open original notice ↗" link: the NYC City Record
 * collectors built `https://a856-cityrecord.nyc.gov/{id}`, which is NOT a notice
 * page — it redirects to the publisher's own error page
 * (`/Error/Error404?aspxerrorpath=/{id}`, answering HTTP 200). Verified against
 * the live publisher on 2026-09-18 for notice ids 20260902028 (the homepage
 * example, bid 134946) and 20260909003.
 *
 * The canonical notice URL is `/RequestDetail/{id}`. Both collectors
 * (src/lib/city-procurement.ts mapNyc and src/jobs/sources/socrata.ts) now share
 * this one helper so a future NYC City Record row can never carry a dead link.
 */
import { describe, expect, test } from "bun:test";
import { nycCityRecordNoticeUrl } from "~/lib/city-procurement";

describe("NEW NYC City Record notice URLs resolve", () => {
  test("the canonical notice page is /RequestDetail/{id}", () => {
    expect(nycCityRecordNoticeUrl("20260902028")).toBe(
      "https://a856-cityrecord.nyc.gov/RequestDetail/20260902028",
    );
  });

  test("the dead bare-id form is never produced again", () => {
    for (const id of ["20260902028", "20260909003", "20260810059"]) {
      const url = nycCityRecordNoticeUrl(id);
      expect(url).not.toBe(`https://a856-cityrecord.nyc.gov/${id}`);
      expect(new URL(url).pathname).toBe(`/RequestDetail/${id}`);
    }
  });

  test("an id is encoded, never interpolated raw", () => {
    expect(nycCityRecordNoticeUrl("a b/c")).toBe(
      "https://a856-cityrecord.nyc.gov/RequestDetail/a%20b%2Fc",
    );
  });
});
