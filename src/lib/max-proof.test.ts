import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_PROOF, maxProofBidOpen, maxProofBullets } from "./max-proof";

// Owner 2026-11-08: homepage before/after with a real construction bid and Max's real answer.
describe("homepage Max proof", () => {
  test("bullets are Max's sentences, words unchanged", () => {
    for (const lang of ["en", "es"] as const) {
      const bullets = maxProofBullets(MAX_PROOF.max[lang]);
      expect(bullets.length).toBe(4);
      expect(bullets.join(" ")).toBe(MAX_PROOF.max[lang]);
    }
    expect(maxProofBullets(MAX_PROOF.max.en)[2]).toBe("There's no special set-aside, so any qualified team can submit.");
  });

  test("the notice excerpt is the start of the real notice and ends on a sentence", () => {
    expect(MAX_PROOF.notice.startsWith("The City of Lexington, North Carolina is soliciting Statements of Qualifications")).toBe(true);
    expect(MAX_PROOF.notice.endsWith("WQ0047265.")).toBe(true);
    expect(MAX_PROOF.notice.length).toBeLessThan(MAX_PROOF.noticeChars);
  });

  test("the bid link shows only while the bid is open", () => {
    expect(maxProofBidOpen(Date.parse("2026-11-08T12:00:00Z"))).toBe(true);
    expect(maxProofBidOpen(Date.parse("2026-12-09T12:00:00Z"))).toBe(false);
  });

  test("it sits on the homepage right under the search and the $5 strip", () => {
    const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    const i = home.indexOf("<StarterPassStrip />");
    const j = home.indexOf("<HomeMaxProof />");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j).toBeLessThan(home.indexOf("<HomeAppStrip />"));
  });
});

describe("date accuracy (owner 2026-11-09)", () => {
  test("Max's answer names the notice's own due date", async () => {
    const { maxProofDateConsistent, maxProofDueLabel } = await import("./max-proof");
    expect(maxProofDateConsistent()).toBe(true);
    expect(maxProofDueLabel()).toBe("December 7, 2026");
  });
  test("the example hides itself if the bid's due date changes in the database", async () => {
    const { maxProofStillCurrent } = await import("./max-proof");
    expect(maxProofStillCurrent("2026-12-07T20:00:00.000Z")).toBe(true); // 3 PM Eastern on Dec 7
    expect(maxProofStillCurrent("2026-12-02T22:00:00.000Z")).toBe(false);
    expect(maxProofStillCurrent(null)).toBe(false);
    const home = readFileSync("src/routes/index.tsx", "utf8");
    expect(home).toContain("{maxProofCurrent !== false ? <HomeMaxProof /> : null}");
  });
  test("the notice card shows its due date and source; the answer cites it", () => {
    const c = readFileSync("src/components/HomeMaxProof.tsx", "utf8");
    expect(c).toContain("Due {maxProofDueLabel(true)} (from the notice)");
    expect(c).toContain("Source: the {MAX_PROOF.agency} notice; the due date Max gives matches");
  });
});
