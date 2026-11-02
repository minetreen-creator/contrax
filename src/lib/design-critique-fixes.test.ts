import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agencyDisplay, bidStarterHref, daysLeftLabel, jobSummary, valueLabel } from "./bid-job-summary";
import { paidPlanReturn } from "./purchase-intent";
import { PREVIEW_MIN_DAYS, roomToBidFirst } from "./radar-closing-soon";

// Owner 2026-11-02: "fix all" after the Impeccable design critique of the
// homepage, bid page and Radar results.
const read = (f: string) => readFileSync(f, "utf8");
const NOW = Date.parse("2026-11-02T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("bid page: the job is free to read", () => {
  test("jobSummary cleans HTML, skips empty or title-only text, and trims long text", () => {
    expect(jobSummary(null, "Mowing")).toBeNull();
    expect(jobSummary("Mowing", "Mowing")).toBeNull();
    expect(jobSummary("short", "x")).toBeNull();
    expect(jobSummary("<p>Mowing &amp; trimming of 14 city parks, twice a month from April to October.</p>", "Park Mowing")).toBe(
      "Mowing & trimming of 14 city parks, twice a month from April to October.",
    );
    // Source and process notes are not the job (live check 2026-11-02: a BidNet
    // bid showed "Listed by BidNet Direct… Contrax stores the deadline…").
    expect(
      jobSummary(
        "Listed by BidNet Direct (bidnetdirect.com), a private third-party bid service — not the State of Washington's procurement portal — in its Washington Purchasing Group. Published 10/30/2026; closing 12/01/2026. BidNet's public list prints the closing DATE only, so Contrax stores the deadline at 11:59 PM Eastern on that date.",
        "Pre-Approved ADU Design Services",
      ),
    ).toBeNull();
    expect(
      jobSummary(
        "State of Oklahoma bidding event 123 posted by DOT. Mowing and litter pickup on 40 miles of state highway right-of-way in Tulsa County. Event documents and responses through the Oklahoma supplier portal (see source link).",
        "Highway Mowing",
      ),
    ).toBe("Mowing and litter pickup on 40 miles of state highway right-of-way in Tulsa County.");
    const long = "Contractor shall provide grounds maintenance services ".repeat(20);
    const out = jobSummary(long, "Grounds")!;
    expect(out.length).toBeLessThanOrEqual(421);
    expect(out.endsWith("…")).toBe(true);
  });
  test("header pieces read like a contractor would say them", () => {
    expect(valueLabel("Not specified")).toBeNull();
    expect(valueLabel("$45,000")).toBe("$45,000");
    expect(daysLeftLabel(inDays(30), NOW)).toBe("30 days left");
    expect(daysLeftLabel(inDays(0.5), NOW)).toBe("1 day left");
    expect(daysLeftLabel(inDays(-1), NOW)).toBeNull();
    expect(agencyDisplay("693JK4 OST")).toBe("Federal agency");
    expect(agencyDisplay("36C250")).toBe("Federal agency");
    expect(agencyDisplay("City of Waco")).toBe("City of Waco");
    expect(agencyDisplay("Washington Purchasing Group (BidNet Direct)")).toBe("Washington Purchasing Group (BidNet Direct)");
  });
  test("the $5 button keeps the bid through signup to the plan page", () => {
    expect(bidStarterHref(42, true)).toBe("/upgrade?plan=starter&bid=42");
    expect(bidStarterHref(42, false)).toBe(`/signup?plan=starter&bid=42&next=${encodeURIComponent("/upgrade?plan=starter&bid=42")}`);
    expect(paidPlanReturn("/upgrade?plan=starter&bid=42")).toBe("/upgrade?plan=starter&bid=42");
    expect(paidPlanReturn("/upgrade?plan=starter&bid=4x2")).toBe("/upgrade?plan=starter");
    // Checkout check 2026-11-02: signup rebuilt the plan return and dropped the bid.
    const signup = read("src/routes/signup.tsx");
    expect(signup).toContain("purchaseReturn.replace(/^\\/upgrade\\?plan=[a-z]+/, `/upgrade?plan=${selectedPlan}`)");
    expect(signup).toContain('"Create my account, then pay $5 →"');
    const upgrade = read("src/routes/upgrade.tsx");
    expect(upgrade).toContain('{bid ? "← Back to the bid"');
  });
  test("the page shows the job, one lock, and no $79 pitch to visitors", () => {
    const page = read("src/routes/bid.$bidId.tsx");
    expect(page).toContain('aria-label="What the job is"');
    expect(page).toContain("{checked && signedIn && (");
    expect(read("src/components/MaxAssistant.tsx")).toContain("const [voiceOn, setVoiceOn] = useState(false);");
  });
});

describe("radar results", () => {
  test("the free preview prefers a bid with a week or more left", () => {
    expect(PREVIEW_MIN_DAYS).toBe(7);
    const rows = [{ id: "3d", due: inDays(3) }, { id: "20d", due: inDays(20) }, { id: "none", due: null }, { id: "8d", due: inDays(8) }];
    expect(roomToBidFirst(rows, (r) => r.due, NOW).map((r) => r.id)).toEqual(["20d", "none", "8d", "3d"]);
  });
  test("anonymous visitors see the free card once, the real total, and the $5 price", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain("{state !== \"\" && !(isAnonymous && (scan.sections?.local ?? []).length > 0) && (");
    expect(radar).toContain("total={visibleCount + locked}");
    expect(radar).toContain('trackEvent("radar_anon_pass_offer_click"');
    expect(radar).toContain("{isAnonymous && scan.matches.length > 0 && locked === 0 && (\n              <SaveMatchesCard");
    expect(radar).toContain("(scan.sections?.related ?? []).length > 0 && (");
    expect(radar).not.toContain("full incumbent intel");
    expect(radar).toContain("🔒 Official notice + bid documents: ${STARTER_FIRST_MONTH_PRICE} for 30 days");
    expect(radar).not.toContain("Official notice for members: details");
    expect(radar).not.toContain('reasons.push("Estimated value not listed');
  });
});

describe("homepage", () => {
  const page = read("src/routes/index.tsx");
  test("one path down the page, closing on the $5 pass", () => {
    expect(page).not.toContain("<MoneyCounter");
    expect(page).not.toContain("<EndingNearYou");
    expect(page).not.toContain("<FreeToolsStrip");
    expect(page.indexOf("<HowItWorks />")).toBeLessThan(page.indexOf("<HomeStateMap"));
    expect(page).toContain('<StarterPassStrip where="closing" />');
  });
  test("search results name the $5 pass before the free account", async () => {
    const finder = read("src/components/HomeContractFinder.tsx");
    expect(finder).toContain('trackEvent("home_results_pass_click"');
    // Design pass (owner 2026-11-02, "do all but 4"): the trust line sits under
    // the search button on every screen size, and the badge and glow are gone.
    expect(finder).toContain('checks: ["Real government bids", "No card to search", "No automatic renewal"],');
    expect(finder).not.toContain("blur-3xl");
    expect(finder).not.toContain("c.badge");
    const { QUICK_TRADES } = await import("../components/HomeContractFinder");
    expect(QUICK_TRADES).toEqual(["Landscaping", "Janitorial", "HVAC", "Plumbing", "Roofing", "Electrical", "Welding", "Construction"]);
    expect(finder).not.toContain("Or type your trade or NAICS");
  });
});
