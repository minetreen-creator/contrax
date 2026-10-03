import { describe, expect, test } from "bun:test";
import {
  parseShareParams,
  radarSearchUrl,
  radarShareUrl,
  shareDescription,
  shareHtml,
  shareImageFor,
  shareTitle,
  tradeSlug,
  type ShareCardInput,
} from "./radar-share";

const base: ShareCardInput = {
  trade: "janitorial",
  state: "NC",
  count: 23,
  cap: 25,
  closestDue: "2026-10-14T16:00:00Z",
  now: "2026-10-03T16:00:00Z",
};

describe("share links", () => {
  test("slug round-trips trade and state", () => {
    expect(tradeSlug("Security Guard")).toBe("security-guard");
    expect(radarShareUrl("Security Guard", "nc")).toBe("https://www.contrax.company/r/security-guard/nc");
    expect(parseShareParams("security-guard", "nc")).toEqual({ trade: "security guard", state: "NC" });
    expect(parseShareParams("janitorial", "North Carolina")).toEqual({ trade: "janitorial", state: "NC" });
  });

  test("no link without both a trade and a valid state", () => {
    expect(radarShareUrl("janitorial", "")).toBeNull();
    expect(radarShareUrl("", "NC")).toBeNull();
    expect(parseShareParams("janitorial", "zz")).toBeNull();
    expect(parseShareParams("%E0%A4%A", "nc")).toBeNull();
  });

  test("click lands on the same Radar search, tagged as a share", () => {
    expect(radarSearchUrl("janitorial", "NC")).toBe(
      "/radar?trade=janitorial&state=NC&utm_source=share&utm_medium=social&utm_campaign=radar_share",
    );
  });

  test("trade pictures", () => {
    expect(shareImageFor("janitorial")).toBe("https://www.contrax.company/og/janitorial.png");
    expect(shareImageFor("commercial cleaning")).toContain("/og/janitorial.png");
    expect(shareImageFor("security guard")).toContain("/og/security.png");
    expect(shareImageFor("it services")).toContain("/og/it.png");
    expect(shareImageFor("submarine")).toContain("/og/general.png");
  });
});

describe("preview text", () => {
  test("live count, state name, closest deadline", () => {
    expect(shareTitle(base)).toBe("23 open janitorial contracts in North Carolina | Contrax");
    expect(shareDescription(base)).toContain("Closest deadline Oct 14.");
    expect(shareDescription(base)).toContain("Updated Oct 3.");
  });

  test("never promises more than the Radar list shows", () => {
    expect(shareTitle({ ...base, count: 40 })).toBe("25+ open janitorial contracts in North Carolina | Contrax");
    expect(shareTitle({ ...base, count: 1 })).toBe("1 open janitorial contract in North Carolina | Contrax");
  });

  test("zero or unknown: no made-up number", () => {
    expect(shareTitle({ ...base, count: 0 })).toBe("Janitorial contracts in North Carolina: get alerted when one posts | Contrax");
    expect(shareTitle({ ...base, count: null })).toBe("Open janitorial contracts in North Carolina | Contrax");
    expect(shareDescription({ ...base, count: null })).not.toContain("Closest deadline");
  });

  test("page carries OG tags, escapes text and redirects people", () => {
    const html = shareHtml({ ...base, trade: 'a"<b' });
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image" content="https://www.contrax.company/og/general.png"');
    expect(html).toContain("a&quot;&lt;b");
    expect(html).not.toContain('a"<b');
    expect(html).toContain("location.replace(");
    expect(shareHtml(base)).toContain('content="23 open janitorial contracts in North Carolina | Contrax"');
  });
});
