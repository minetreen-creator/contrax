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

// Owner 2026-11-14 (idea 2): after a bid has gone out to contractors, tell its buyer.
import { buyerEmail } from "./outreach";

describe("buyer note", () => {
  const m = outreachEmail({ ...base, kind: "buyer", business: "Rockbridge County Public Schools", place: "12" });
  test("reports what was sent, with the real count, and asks for nothing", () => {
    expect(m.subject).toBe("We sent your construction bid to 12 local contractors");
    expect(m.text).toContain("We recently emailed your open solicitation to 12 local contractors:");
    expect(m.text).toContain("Construction of Recreation Center");
    expect(m.text).toContain("There is nothing you need to do.");
    expect(m.text).not.toContain("$");
    expect(m.text).toContain("this address is listed with the solicitation above");
    expect(m.text).toContain(base.unsubscribeUrl);
    expect(outreachEmail({ ...base, kind: "buyer", place: "1" }).subject).toBe("We sent your construction bid to 1 local contractor");
  });
  test("only a public body's own address is a buyer; portals, vendors and no-reply boxes are not", () => {
    expect(buyerEmail(["support@bidnetdirect.com", "jsmith@rockbridgecountyva.gov"])).toBe("jsmith@rockbridgecountyva.gov");
    expect(buyerEmail(["purchasing@harrisonburg.k12.va.us"])).toBe("purchasing@harrisonburg.k12.va.us");
    expect(buyerEmail(["procurement@odu.edu"])).toBe("procurement@odu.edu");
    expect(buyerEmail(["bids@townofpulaski.org"])).toBeNull();
    expect(buyerEmail(["noreply@fairfaxcounty.gov", "sales@acme-roofing.com"])).toBeNull();
    expect(buyerEmail(["help@sam.gov", "fsd@fsd.gov"])).toBeNull();
    expect(buyerEmail([])).toBeNull();
  });
  test("the note counts sent emails only, goes once per buyer, and waits for approval", () => {
    const srv = readFileSync("src/lib/outreach.server.ts", "utf8");
    expect(srv).toContain("WHERE c.kind IN ('first', 'pack') AND c.status = 'sent'");
    expect(srv).toContain("NOT EXISTS (SELECT 1 FROM outreach_contacts x WHERE x.kind = 'buyer' AND x.bid_id = c.bid_id)");
    const job = readFileSync("src/jobs/buyer-notes.ts", "utf8");
    expect(job).toContain('const apply = process.env.APPLY === "true";');
    expect(readFileSync(".github/workflows/buyer-notes.yml", "utf8")).toContain("SENDS NOTHING");
  });
});
