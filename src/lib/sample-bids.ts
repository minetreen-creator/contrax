import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL, SOURCE_CLASSES } from "~/lib/source-class";
import { isProductBuy } from "~/lib/trade-classification";
import { cleanBidTitle, fixTitleTypos, isCodeHeavyTitle } from "~/lib/bid-title";
import { displayLocation } from "~/lib/agency-display";
import { isAggregatorMirror } from "~/lib/notice-dedupe";
import { bidIsServiceJob } from "~/lib/outreach";
import { resolveBidState, STATE_CODE_TO_NAME } from "~/lib/location-state";
import { publicAgency, publicTitle } from "~/lib/public-bid";

function sampleStateName(r: { location?: unknown; agency?: unknown }): string | null {
  const code = resolveBidState(r.location ? String(r.location) : null, r.agency ? String(r.agency) : null);
  return code ? (STATE_CODE_TO_NAME[code] ?? null) : null;
}

// Live sample of REAL open SDVOSB set-asides, NEWEST first (owner 2026-10-03:
// "closing soonest" showed the same five rows day after day until each aged
// out, so the site looked stale). Each is still at least two days from its
// deadline so it stays actionable. SERVICE work only: parts and supply orders
// (SAM's "59--ACCESSORY KIT" product listings, numeric FSC prefixes, and
// titles isProductBuy recognises) are not something a contractor bids on.
// Used by the homepage hero card and the /bid-scout example. Never throws: a
// failed query returns [] and callers hide the sample.
export type SampleBid = {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due_date: string | null;
  set_aside: string | null;
  source_url: string | null;
  /** When Contrax first recorded the notice (ISO). */
  created_at: string | null;
};

/** SAM product listings lead with a numeric Federal Supply Class ("59--…", "6515--…"); services lead with a letter ("S201--…"). */
export function isProductListingTitle(title: string): boolean {
  return /^\s*\d{2,4}\s*--/.test(title) || isProductBuy(title.toLowerCase());
}

export const getSdvosbSample = createServerFn({ method: "GET" }).handler(
  async (): Promise<SampleBid[]> => {
    try {
      const { sql } = await import("~/db");
      const rows = (await sql()`
        SELECT id, title, agency, location, due_date, set_aside, source_url, created_at
        FROM bids
        WHERE due_date::date >= (NOW() + INTERVAL '2 days')::date
          AND title !~ '^[[:space:]]*[0-9]{2,4}[[:space:]]*--'
          ${setAsidePred("sdvosb", sql)}
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 60
      `) as any[];
      const seen = new Set<string>();
      const picked = rows.filter((r) => {
        const title = String(r.title ?? "");
        // Homepage examples must read as plain English (owner 2026-10-04).
        if (!title || isProductListingTitle(title) || isCodeHeavyTitle(title)) return false;
        const key = `${title.toLowerCase()}|${String(r.agency ?? "").toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return picked.slice(0, 5).map((r) => ({
        id: Number(r.id),
        // Owner 2026-11-18 ("no more freebies"): the buyer is described, not named (src/lib/public-bid.ts).
        title: publicTitle(fixTitleTypos(cleanBidTitle(String(r.title ?? "")).title), r.agency ? String(r.agency) : null),
        agency: publicAgency(r.agency ? String(r.agency) : null, sampleStateName(r)),
        location: displayLocation(r.location),
        due_date: r.due_date ? String(r.due_date) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      }));
    } catch {
      return [];
    }
  },
);

/**
 * Everyday-trade examples for the homepage (owner 2026-10-31: the "Live SDVOSB
 * opportunities" strip showed VA hospital fire-alarm and pneumatic-tube jobs
 * under jargon a janitorial or landscaping owner doesn't use). Real open bids,
 * newest first, at least two days from the deadline, at most one per trade so
 * the row shows the range of work. Never throws: [] hides the strip.
 */
export const EVERYDAY_SAMPLE_TRADES: { naics: string; label: string }[] = [
  { naics: "561720", label: "Janitorial" },
  { naics: "561730", label: "Landscaping" },
  { naics: "238220", label: "HVAC & plumbing" },
  { naics: "561612", label: "Security guards" },
  { naics: "236220", label: "Construction" },
];

export type EverydaySampleBid = SampleBid & { trade: string };

/**
 * Work a tradesperson does with their own crew: the outreach rule
 * (bidIsServiceJob: no supplies, RFIs, design or consulting) plus engineering,
 * architecture and "professional services" contracts (owner 2026-10-31: an MEP
 * engineering ordering agreement showed as the HVAC example). PURE.
 */
export function isHandsOnWork(title: string): boolean {
  return bidIsServiceJob(title);
}

/**
 * One row per trade, in EVERYDAY_SAMPLE_TRADES order, skipping unreadable
 * titles. A bid listed by the agency itself wins over an aggregator copy
 * ("Washington Purchasing Group (BidNet Direct)"), which is used only when a
 * trade has nothing else (owner 2026-10-31). PURE.
 */
/**
 * A row whose place contradicts where its source buys (owner 2026-11-16: the homepage showed
 * "Sector NOLA Water Treatment for HVAC · A New Hampshire public agency · New Orleans, LA", a
 * federal New Orleans job re-listed under New Hampshire's BidNet group). A source that posts for
 * one state must not show a job located in another. Sources with no home state, and rows with no
 * state in their location, are left alone. PURE.
 */
export function placeContradictsSource(r: { source?: string | null; location?: string | null }): boolean {
  const entry = SOURCE_CLASSES[String(r.source ?? "")];
  // State and local sources only: a federal source buys everywhere.
  const home = entry && entry.class !== "federal" ? entry.scopeState : undefined;
  const where = resolveBidState(r.location ?? null, null);
  return !!home && !!where && where !== home;
}

/** A federal source label ("sam_gov", "sam_naics_561720", a state-name door). PURE. */
function isFederalSource(source: string | null | undefined): boolean {
  const s = String(source ?? "");
  return SOURCE_CLASSES[s]?.class === "federal" || /^sam/i.test(s);
}

/**
 * A job a U.S. tradesperson could drive to: its location names a U.S. state, and neither the
 * title nor the buyer is an embassy, consulate or overseas post. PURE.
 */
export function isDomesticExample(r: { title?: string | null; agency?: string | null; location?: string | null }): boolean {
  if (/\b(embassy|embassies|consulate|overseas|oconus)\b/i.test(`${r.title ?? ""} ${r.agency ?? ""}`)) return false;
  return resolveBidState(r.location ?? null, null) !== null;
}

export function pickEverydaySample(
  rows: readonly { naics_code: string | null; title: string | null; agency: string | null; source?: string | null; location?: string | null }[],
): number[] {
  const picked: number[] = [];
  for (const { naics } of EVERYDAY_SAMPLE_TRADES) {
    const fits = (r: (typeof rows)[number]) => {
      const title = String(r.title ?? "");
      return (
        r.naics_code === naics &&
        !!title &&
        !isProductListingTitle(title) &&
        !isCodeHeavyTitle(title) &&
        isHandsOnWork(title) &&
        !placeContradictsSource(r) &&
        isDomesticExample(r)
      );
    };
    // Owner 2026-11-16 (homepage review): the first example was apartment cleaning for the U.S.
    // Embassy in Madrid. Every example is a job in a U.S. state, and a state, city, county or
    // school buyer comes before a federal one: that is the work the page is about.
    const direct = (r: (typeof rows)[number]) => fits(r) && !isAggregatorMirror(r);
    let i = rows.findIndex((r) => direct(r) && !isFederalSource(r.source));
    if (i < 0) i = rows.findIndex(direct);
    if (i < 0) i = rows.findIndex(fits);
    if (i >= 0) picked.push(i);
  }
  return picked;
}

export const getEverydaySample = createServerFn({ method: "GET" }).handler(
  async (): Promise<EverydaySampleBid[]> => {
    try {
      const { sql } = await import("~/db");
      const codes = EVERYDAY_SAMPLE_TRADES.map((t) => t.naics);
      const rows = (await sql()`
        SELECT id, title, agency, location, due_date, set_aside, source_url, created_at, naics_code, source
        FROM bids
        WHERE due_date::date >= (NOW() + INTERVAL '2 days')::date
          AND naics_code = ANY(${codes})
          AND title !~ '^[[:space:]]*[0-9]{2,4}[[:space:]]*--'
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 600
      `) as any[];
      const label = new Map(EVERYDAY_SAMPLE_TRADES.map((t) => [t.naics, t.label]));
      return pickEverydaySample(rows).map((i) => {
        const r = rows[i];
        return {
          id: Number(r.id),
          // Owner 2026-11-18 ("no more freebies"): the buyer is described, not named (src/lib/public-bid.ts).
          title: publicTitle(fixTitleTypos(cleanBidTitle(String(r.title ?? "")).title), r.agency ? String(r.agency) : null),
          agency: publicAgency(r.agency ? String(r.agency) : null, sampleStateName(r), r.source ? String(r.source) : null),
          location: displayLocation(r.location),
          due_date: r.due_date ? String(r.due_date) : null,
          set_aside: r.set_aside ? String(r.set_aside) : null,
          source_url: r.source_url ? String(r.source_url) : null,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
          trade: label.get(String(r.naics_code)) ?? "",
        };
      });
    } catch {
      return [];
    }
  },
);
