import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  companyDescription,
  companyIndexable,
  companyPath,
  companySitemapIndexXml,
  companySitemapXml,
  companySlug,
  companySubhead,
  companyTitle,
  EMPTY_COMPANY_PAGE,
  pageTrades,
  topCount,
  tradeList,
  tradeSection,
  ueiFromSlug,
  type CompanyPageData,
} from "./company-pages";

const readSrc = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const UEI = "ABCD1234EFGH";

const page = (over: Partial<CompanyPageData> = {}): CompanyPageData => ({
  ...EMPTY_COMPANY_PAGE,
  found: true,
  uei: UEI,
  name: "Acme Paving LLC",
  city: "Richmond",
  state: "VA",
  stateName: "Virginia",
  path: companyPath("Acme Paving LLC", UEI),
  trades: [
    tradeSection({ slug: "construction", label: "Construction", radarTerm: "construction" }, "VA", "Virginia", { count: 14, nationwideCount: 3, bids: [] }),
    tradeSection({ slug: "landscaping", label: "Landscaping", radarTerm: "landscaping" }, "VA", "Virginia", { count: 2, nationwideCount: 0, bids: [] }),
  ],
  ...over,
});

describe("company page links", () => {
  test("the slug is the name plus the UEI, and the UEI reads back out", () => {
    expect(companySlug("Acme Paving, LLC", UEI)).toBe("acme-paving-llc-abcd1234efgh");
    expect(ueiFromSlug("acme-paving-llc-abcd1234efgh")).toBe(UEI);
    expect(ueiFromSlug(UEI.toLowerCase())).toBe(UEI);
    expect(companySlug("***", UEI)).toBe("business-abcd1234efgh");
  });

  test("a slug that does not end in a UEI is refused", () => {
    expect(ueiFromSlug("acme-paving")).toBeNull();
    expect(ueiFromSlug("acmepavingllcabcd1234efgh")).toBeNull();
    expect(ueiFromSlug("acme-abcd1234efg!")).toBeNull();
    expect(ueiFromSlug("")).toBeNull();
  });

  test("a long name is cut without a trailing dash", () => {
    const slug = companySlug("A".repeat(59) + " Builders Incorporated", UEI);
    expect(slug.endsWith(`-${UEI.toLowerCase()}`)).toBe(true);
    expect(slug).not.toContain("--");
  });
});

describe("company page wording", () => {
  test("the headline count is the largest single trade, never a sum", () => {
    const d = page();
    expect(topCount(d)).toBe(14);
    expect(companySubhead(d)).toContain("14 government construction bids are open in Virginia");
    expect(companyTitle(d)).toBe("Acme Paving LLC (Richmond, VA): government bids open now | Contrax");
    expect(companyDescription(d)).toContain("14 open construction bids in Virginia");
    expect(tradeList(d)).toBe("construction and landscaping");
  });

  test("one bid reads in the singular", () => {
    const d = page({ trades: [tradeSection({ slug: "hvac", label: "HVAC and plumbing", radarTerm: "hvac" }, "VA", "Virginia", { count: 1, nationwideCount: 0, bids: [] })] });
    expect(companySubhead(d)).toContain("1 government HVAC and plumbing bid is open");
    expect(companySubhead(d)).toContain("that fits the trades");
  });

  test("no state bids: nationwide ones are named, and never counted as the state's", () => {
    const d = page({ trades: [tradeSection({ slug: "trucking", label: "Trucking and hauling", radarTerm: "trucking" }, "VA", "Virginia", { count: 0, nationwideCount: 5, bids: [] })] });
    expect(topCount(d)).toBe(0);
    expect(companySubhead(d)).toContain("No Virginia bids");
    expect(companySubhead(d)).toContain("5 nationwide ones are open");
    expect(companyIndexable(d)).toBe(true);
  });

  test("a page with nothing open, or no business, stays out of search results", () => {
    const none = page({ trades: [tradeSection({ slug: "trucking", label: "Trucking and hauling", radarTerm: "trucking" }, "VA", "Virginia", { count: 0, nationwideCount: 0, bids: [] })] });
    expect(companyIndexable(none)).toBe(false);
    expect(companyIndexable(EMPTY_COMPANY_PAGE)).toBe(false);
    expect(companyIndexable(page())).toBe(true);
  });

  test("a trade section links Radar and the state page for that trade", () => {
    const t = page().trades[0]!;
    expect(t.radarHref).toContain("trade=construction");
    expect(t.radarHref).toContain("state=VA");
    expect(t.statePath).toBe("/contracts-in/virginia/construction");
  });

  test("only trades with pages are used, at most three", () => {
    expect(pageTrades(["construction", "not-a-trade", "hvac", "electrical", "janitorial"]).map((t) => t.slug)).toEqual(["construction", "hvac", "electrical"]);
  });
});

describe("company sitemaps", () => {
  test("the index has one child per state and each child lists company pages", () => {
    expect(companySitemapIndexXml(["VA", "TX"])).toContain("<loc>https://www.contrax.company/sitemap-companies.xml?state=VA</loc>");
    const xml = companySitemapXml([{ name: "Acme Paving LLC", uei: UEI }]);
    expect(xml).toContain("<loc>https://www.contrax.company/company/acme-paving-llc-abcd1234efgh</loc>");
  });

  test("robots.txt names the company sitemap", () => {
    expect(readSrc("public/robots.txt")).toContain("Sitemap: https://www.contrax.company/sitemap-companies.xml");
  });
});

describe("company page rules", () => {
  const route = readSrc("src/routes/company.$slug.tsx");
  const server = readSrc("src/lib/company-pages.server.ts");

  test("only public registration facts are read: no website, phone, email or contact name", () => {
    const select = server.slice(server.indexOf("SELECT r.uei, r.name"), server.indexOf("FROM sam_registrants r"));
    expect(select).not.toContain("url");
    expect(select).not.toContain("zip");
    expect(route).not.toMatch(/\bd\.url\b/);
    expect(route).not.toMatch(/phone|contact name/i);
  });

  test("the page says we are not affiliated and have not contacted the business", () => {
    expect(route).toContain("is not affiliated with this business and has not contacted it");
  });

  test("a removed business has no page and is not linked", () => {
    expect(server.match(/company_page_optouts/g)!.length).toBeGreaterThanOrEqual(4);
    expect(route).toContain("Remove company page");
  });

  test("the bid count comes from Radar's own state matches, reused between pages", () => {
    expect(server).toContain("stateRadarMatches(sql, { trade: trade.radarTerm, state })");
    expect(server).toContain("filterBidsToState(");
    expect(server).toContain("trade_state_bid_cache");
  });

  test("pages with no open bids are noindex, and the tables are in the schema", () => {
    expect(route).toContain("if (!companyIndexable(d))");
    const schema = readSrc("src/db/schema.sql");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS trade_state_bid_cache");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS company_page_optouts");
  });
});

describe("company page labels", () => {
  test("HVAC and IT keep their capitals, and a shared certification name shows once", async () => {
    const { lowerTrade, certLabels } = await import("./company-pages");
    expect(lowerTrade("IT services")).toBe("IT services");
    expect(lowerTrade("HVAC and plumbing")).toBe("HVAC and plumbing");
    expect(lowerTrade("Construction")).toBe("construction");
    const labels = certLabels(["wosb", "edwosb", "wosb", "8a"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(readSrc("src/routes/company.$slug.tsx")).not.toContain("t.label.toLowerCase()");
  });
});

describe("warming the company page lists", () => {
  const job = readSrc("src/jobs/warm-company-pages.ts");
  const wf = readSrc(".github/workflows/warm-company-pages.yml");
  const server = readSrc("src/lib/company-pages.server.ts");

  test("the job recomputes every trade + state pair after each bid sync", () => {
    expect(wf).toContain('workflows: ["Sync Bids"]');
    expect(wf).toContain("bun run src/jobs/warm-company-pages.ts");
    expect(job).toContain("companyTradeStatePairs()");
    expect(job).toContain("computeTradeStateMatches(");
    expect(server).toContain("SELECT DISTINCT state, unnest(trades) AS trade FROM sam_registrants");
  });

  test("a page still recomputes a list that is missing or too old, and a few failures do not fail the job", async () => {
    const { COMPANY_CACHE_MINUTES } = await import("./company-pages");
    expect(COMPANY_CACHE_MINUTES).toBeGreaterThan(24 * 60);
    expect(server).toContain("return computeTradeStateMatches(trade, state);");
    expect(job).toContain("failed > pairs.length / 2 ? 1 : 0");
  });
});

describe("find your company", () => {
  const page = readSrc("src/routes/company.index.tsx");
  const server = readSrc("src/lib/company-pages.server.ts");

  test("a plain form that searches by business name, with the state optional", () => {
    expect(page).toContain('createFileRoute("/company/")');
    expect(page).toContain('<form method="get" action="/company"');
    expect(page).toContain("minLength={3}");
    expect(page).toContain('<option value="">Any state</option>');
  });

  test("results link to company pages, leave out removed businesses, and show no website or contact", () => {
    const fn = server.slice(server.indexOf("export async function searchCompanyPages"));
    expect(fn).toContain("company_page_optouts");
    expect(fn).toContain("SELECT r.uei, r.name, r.city, r.state FROM sam_registrants r");
    expect(fn).toContain("if (q.length < 3) return [];");
    expect(fn).toContain("path: companyPath(r.name, r.uei)");
    expect(page).not.toMatch(/\.url\b|phone|email/i);
  });

  test("a search result page stays out of search engines; the bare page does not", () => {
    expect(page).toContain("if (loaderData?.q)");
    expect(page).toContain('canonical: "https://www.contrax.company/company"');
  });

  test("the footer and the not-found page link to it", () => {
    expect(readSrc("src/lib/seo-landing.tsx")).toContain('<a href="/company" className="transition-colors hover:text-white">Find Your Company</a>');
    expect(readSrc("src/routes/company.$slug.tsx")).toContain('<a href="/company"');
  });
});
