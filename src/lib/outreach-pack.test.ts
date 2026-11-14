import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { outreachEmail } from "./outreach";

// Owner 2026-11-14: "Send the Bid Pack offer to 30 construction firms, each with
// one real open bid." The first pack is free; one ask, no price.
const base = {
  business: "Oak Builders LLC",
  bidId: 1220290,
  bidTitle: "Construction of Recreation Center",
  buyer: "Rockbridge County Public Schools",
  due: "2026-12-01",
  tradeLabel: "construction",
  postalAddress: "100 Main St, Richmond VA 23219",
  unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=abc",
  contactId: 7,
};

describe("Bid Pack offer email", () => {
  const m = outreachEmail({ ...base, kind: "pack" });
  test("names the bid, offers one free pack, and asks for a reply", () => {
    expect(m.subject).toBe("Want this construction bid from Rockbridge County Public Schools broken down for you?");
    expect(m.text).toContain("Construction of Recreation Center");
    expect(m.text).toContain("Due: Dec 1, 2026");
    expect(m.text).toContain("https://www.contrax.company/bid/1220290?utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_pack&oc=7");
    expect(m.text).toContain("at no charge");
    expect(m.text).toContain('reply "yes"');
    expect(m.text).not.toContain("$");
  });
  test("carries the postal address and the unsubscribe link like every outreach email", () => {
    for (const part of [m.text, m.html]) {
      expect(part).toContain("100 Main St, Richmond VA 23219");
      expect(part).toContain(base.unsubscribeUrl);
    }
  });
  test("is queued only by a construction focus run that asks for it, and shows its own label", () => {
    const prepare = readFileSync("src/jobs/outreach-prepare.ts", "utf8");
    expect(prepare).toContain('(FOCUS_OFFER === "pack" && FOCUS_STATE ? queuePack : queueFirst)');
    expect(readFileSync("src/lib/outreach.server.ts", "utf8")).toContain("'pack', ${p.business}");
    expect(readFileSync("src/routes/admin/outreach.tsx", "utf8")).toContain('"Bid Pack: free sample"');
    expect(readFileSync(".github/workflows/outreach-prepare.yml", "utf8")).toContain("FOCUS_OFFER: ${{ inputs.offer }}");
  });
});
