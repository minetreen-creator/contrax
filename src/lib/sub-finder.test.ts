import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  cleanPackageInput,
  cleanResponseInput,
  matchListedSubs,
  packageSlug,
  quoteRequestEmail,
  responseEmail,
  shareText,
  toListedSub,
  type ListedSub,
} from "./sub-finder";

// Owner 2026-11-09: Sub Finder ("Pre-Bid Partner Ping"), no cold outreach.
const sub = (o: Partial<ListedSub>): ListedSub => ({ profileId: 1, businessName: "A", trade: "hvac", states: ["VA"], certifications: [], yearsInBusiness: 5, services: [], ...o });

describe("matching listed subs", () => {
  test("filters by trade, state and certification; in-state first", () => {
    const subs = [
      sub({ profileId: 1, businessName: "Nationwide HVAC", states: [] }),
      sub({ profileId: 2, businessName: "VA HVAC", states: ["VA"], certifications: ["sdvosb"] }),
      sub({ profileId: 3, businessName: "MD HVAC", states: ["MD"] }),
      sub({ profileId: 4, businessName: "VA Janitorial", trade: "janitorial" }),
    ];
    expect(matchListedSubs(subs, { trade: "hvac", state: "VA", cert: null }).map((s) => s.profileId)).toEqual([2, 1]);
    expect(matchListedSubs(subs, { trade: "hvac", state: "VA", cert: "sdvosb" }).map((s) => s.profileId)).toEqual([2]);
    expect(matchListedSubs(subs, { trade: null, state: null, cert: null })).toHaveLength(4);
  });

  test("a member profile becomes a listed sub with its trade from NAICS or words", () => {
    const s = toListedSub({ id: 9, business_name: "  ", industry: "Commercial HVAC", service_categories: [], naics_codes: [], states: ["TX"], certifications: ["SDVOSB"], years_in_business: null });
    expect(s).toMatchObject({ profileId: 9, businessName: "A Contrax member", trade: "hvac", certifications: ["sdvosb"] });
  });
});

describe("forms", () => {
  test("a Trade Package needs a trade, a real scope and a company; dates can't be past", () => {
    expect(cleanPackageInput({ trade: "", scope: "x".repeat(30), company: "Prime Co" }, "2026-11-09")).toEqual({ ok: false, error: "Pick the trade you need." });
    expect(cleanPackageInput({ trade: "HVAC", scope: "short", company: "Prime Co" }, "2026-11-09").ok).toBe(false);
    expect(cleanPackageInput({ trade: "HVAC", scope: "Replace two rooftop units at the county library.", company: "" }, "2026-11-09").ok).toBe(false);
    expect(cleanPackageInput({ trade: "HVAC", scope: "Replace two rooftop units at the county library.", company: "Prime Co", quotesDue: "2026-11-01" }, "2026-11-09")).toEqual({ ok: false, error: "The quote due date is in the past." });
    const ok = cleanPackageInput({ trade: "HVAC", state: "va", scope: "Replace two rooftop units at the county library.", company: "Prime Co", quotesDue: "2026-11-20" }, "2026-11-09");
    expect(ok.ok && ok.input.state).toBe("VA");
  });

  test("a quote response needs a company and a real email; the spam trap is caught quietly", () => {
    expect(cleanResponseInput({ company: "Sub Co", email: "nope" }).ok).toBe(false);
    expect(cleanResponseInput({ company: "Sub Co", email: "a@b.co", website: "http://spam" })).toMatchObject({ ok: false, spam: true });
    const r = cleanResponseInput({ company: "Sub Co", email: "Owner@SubCo.com", certifications: ["sdvosb", "made-up", "sdvosb"] });
    expect(r.ok && r.input).toMatchObject({ email: "owner@subco.com", certifications: ["sdvosb"] });
  });

  test("package ids are 10 unambiguous characters", () => {
    expect(packageSlug(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toMatch(/^[a-z2-9]{10}$/);
  });
});

describe("no cold outreach", () => {
  test("every quote request email says why it came and carries the one-click stop link", () => {
    const m = quoteRequestEmail({ title: "Library HVAC", trade: "HVAC", company: "Prime Co", location: "Richmond, VA", quotesDue: "2026-11-20", url: "https://www.contrax.company/trade-package/abcdefghjk" }, "https://www.contrax.company/sub-finder/unlist?p=1&t=x");
    expect(m.text).toContain("You're getting this because you listed your business for primes on Contrax.");
    expect(m.text).toContain("https://www.contrax.company/sub-finder/unlist?p=1&t=x");
    expect(m.text).toContain("Quotes are due November 20, 2026.");
  });

  test("quote requests go only to listed members, capped per package; the prime shares the link themselves", () => {
    const srv = readFileSync(new URL("./sub-finder.server.ts", import.meta.url), "utf8");
    expect(srv).toContain("WHERE p.id = ANY(${wanted}) AND p.listed_for_primes AND p.user_id <> ${primeUserId}");
    expect(srv).toContain("MAX_QUOTE_REQUESTS_PER_PACKAGE");
    const page = readFileSync(new URL("../routes/sub-finder.tsx", import.meta.url), "utf8");
    expect(page).toContain("Send it from your own phone or email to the subs you work with.");
    expect(page).toContain("sms:?&body=");
  });

  test("the prime's response email lets them reply to the sub directly and marks certifications self-reported", () => {
    const m = responseEmail({ title: "Library HVAC", trade: "HVAC", url: "https://x" }, { company: "Sub Co", contactName: "Sam", email: "sam@subco.com", phone: "", certifications: ["wosb"], message: "Can start in December." });
    expect(m.subject).toBe("New quote response from Sub Co: HVAC");
    expect(m.text).toContain("Certifications (self-reported): WOSB");
    expect(shareText({ company: "Prime Co", trade: "hvac", title: "Library HVAC", url: "https://x" })).toBe("Prime Co is collecting hvac quotes for Library HVAC. Scope and quote form: https://x");
  });

  test("entry points: bid pages, megaproject pages, prime finder; in the sitemap; schema mirrored", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("../routes/bid.$bidId.tsx")).toContain("/sub-finder?bid=${bid.id}");
    expect(read("../routes/megaprojects_.$slug.tsx")).toContain("/sub-finder?mega=${p.slug}");
    expect(read("../routes/prime-finder.tsx")).toContain('href="/sub-finder"');
    expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/sub-finder", "weekly", "0.6"]');
    expect(read("../db/schema.sql")).toContain("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS listed_for_primes BOOLEAN NOT NULL DEFAULT FALSE;");
  });
});
