/**
 * Prospect finder — CLI entrypoint (`bun run prospect-finder`), run by hand
 * from .github/workflows/prospect-finder.yml (owner 2026-10-21). For open bids
 * in one state and trade (due 10+ days out), searches Google Places for local
 * businesses in that trade near each bid, then reads each business's own
 * website for the email addresses it publishes. Prints the list and writes
 * prospects.csv. Read-only on the database; sends nothing.
 *
 * Without a working GOOGLE_PLACES_API_KEY it uses the contractor registry
 * (sam_registrants) for the businesses, at no cost (owner 2026-11-14). Checking the
 * list against Sent mail and "Do not contact" happens when the emails are
 * written, not here.
 */
import { writeFileSync } from "node:fs";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { bidPlace, contactLinks, csvCell, extractEmails, placesQuery, registryTrade, siteHost } from "~/lib/prospect-finder";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { emailFitsSite } from "~/lib/outreach";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_PER_BID = 10;
const MIN_DAYS_OUT = 10;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; ContraxProspectFinder/1.0; +https://www.contrax.company)";
/** A registrant listing this many NAICS codes or fewer counts as working in each of them. */
const FOCUSED_NAICS = 5;

interface Place {
  name: string;
  website: string | null;
  address: string | null;
}

export async function searchPlaces(key: string, query: string): Promise<Place[]> {
  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress,places.businessStatus",
    },
    body: JSON.stringify({ textQuery: query, pageSize: PLACES_PER_BID }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    places?: { displayName?: { text?: string }; websiteUri?: string; formattedAddress?: string; businessStatus?: string }[];
  };
  return (data.places ?? [])
    .filter((p) => !p.businessStatus || p.businessStatus === "OPERATIONAL")
    .map((p) => ({ name: p.displayName?.text ?? "", website: p.websiteUri ?? null, address: p.formattedAddress ?? null }));
}

/**
 * The free source (owner 2026-11-14): small businesses in the contractor
 * registry (sam_registrants) in the job's state and trade that list a website.
 * Firms in the job's own town come first; the rest are ordered by a hash of the
 * business and the bid, so each bid reaches different firms. Never throws.
 */
export async function searchRegistrants(opts: { state: string; label: string; place: string; bidId: number; limit?: number }): Promise<Place[]> {
  const t = registryTrade(opts.label);
  if (!t || !/^[A-Z]{2}$/.test(opts.state)) return [];
  try {
    const s = sql();
    const naics = t.naics.length ? t.naics : null;
    // "near Christiansburg, VA 24073": the same three-digit ZIP area comes right after the same town.
    const zip3 = /\b(\d{3})\d{2}\b/.exec(opts.place)?.[1] ?? "";
    const rows = (await s`
      SELECT name, city, state, zip, url FROM sam_registrants
      WHERE state = ${opts.state}
        AND url IS NOT NULL AND url <> ''
        AND ${t.trade} = ANY(trades)
        AND (expires IS NULL OR expires >= CURRENT_DATE)
        AND (${naics}::text[] IS NULL OR naics && ${naics}::text[])
        AND (name ~* ${t.name} OR cardinality(naics) <= ${FOCUSED_NAICS})
      ORDER BY (name ~* ${t.name}) DESC,
               (city <> '' AND POSITION(LOWER(city) IN LOWER(${opts.place})) > 0) DESC,
               (${zip3} <> '' AND LEFT(COALESCE(zip, ''), 3) = ${zip3}) DESC,
               md5(uei || ${String(opts.bidId)})
      LIMIT ${Math.min(Math.max(opts.limit ?? PLACES_PER_BID, 1), 40)}
    `) as { name: string; city: string | null; state: string; zip: string | null; url: string }[];
    return rows.map((r) => ({
      name: r.name,
      website: r.url,
      address: `${r.city ?? ""}, ${r.state} ${(r.zip ?? "").slice(0, 5)}`.trim(),
    }));
  } catch (e) {
    console.log(`   ⚠️ Registry lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

let placesDown = false;

/**
 * Businesses for one bid: Google Places when a key is set and working, else the
 * contractor registry. After the first Places failure the rest of the run goes
 * straight to the registry, so a dead key costs one error line, not one per bid.
 */
export async function findBusinesses(
  key: string,
  query: string,
  reg: { state: string; label: string; place: string; bidId: number; limit?: number },
): Promise<{ places: Place[]; source: "places" | "registry" }> {
  if (key && !placesDown) {
    try {
      return { places: await searchPlaces(key, query), source: "places" };
    } catch (e) {
      placesDown = true;
      console.log(`   ⚠️ Google Places unavailable (${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 90)}). Using the contractor registry for this run.`);
    }
  }
  return { places: await searchRegistrants(reg), source: "registry" };
}

export async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return (await res.text()).slice(0, 1_000_000);
  } catch {
    return "";
  }
}

/** Emails published on the homepage, or failing that on up to two contact/about pages. */
export async function siteEmails(website: string): Promise<{ emails: string[]; page: string }> {
  const host = siteHost(website);
  const home = await fetchPage(website);
  const found = extractEmails(home, host);
  if (found.length) return { emails: found, page: website };
  for (const link of contactLinks(home, website)) {
    const emails = extractEmails(await fetchPage(link), host);
    if (emails.length) return { emails, page: link };
  }
  return { emails: [], page: "" };
}

export async function findProspects(opts: { key: string; state: string; trade: string; bids: number }): Promise<string[][]> {
  const s = sql();
  const like = `%${opts.trade.toLowerCase()}%`;
  const bids = (await s`
    SELECT id, title, agency, location, due_date FROM bids
    WHERE normalized_state = ${opts.state}
      AND due_date >= NOW() + ${`${MIN_DAYS_OUT} days`}::interval
      AND (LOWER(title) LIKE ${like} OR LOWER(COALESCE(description, '')) LIKE ${like})
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    ORDER BY due_date ASC
    LIMIT ${opts.bids}
  `) as { id: number; title: string; agency: string | null; location: string | null; due_date: Date | string }[];
  console.log(`${bids.length} open ${opts.trade} bids in ${opts.state} due ${MIN_DAYS_OUT}+ days out.\n`);

  const rows: string[][] = [];
  const seenSites = new Set<string>();
  for (const b of bids) {
    const due = new Date(b.due_date).toISOString().slice(0, 10);
    const place = bidPlace(b.location, b.agency, opts.state);
    const query = placesQuery(opts.trade, place);
    console.log(`📄 #${b.id} ${b.title} — ${b.agency ?? "-"}, due ${due}`);
    console.log(`   🔎 ${query}`);
    const { places, source } = await findBusinesses(opts.key, query, { state: opts.state, label: opts.trade, place, bidId: b.id });
    if (source === "registry") console.log(`   📇 ${places.length} from the contractor registry`);
    for (const p of places) {
      const host = p.website ? siteHost(p.website) : null;
      if (!p.website || !host || seenSites.has(host)) continue;
      seenSites.add(host);
      const { emails, page } = await siteEmails(p.website);
      // Same rule as the daily outreach: not a site builder's or a placeholder address.
      const email = emails.find((e) => emailFitsSite(e, host, p.name));
      if (!email) continue;
      console.log(`   ✉️ ${p.name} — ${email} (${page})`);
      rows.push([String(b.id), b.title, b.agency ?? "", due, p.name, p.address ?? "", p.website, email, page]);
    }
    console.log("");
  }
  return rows;
}

if (import.meta.main) {
  try {
    const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
    if (!key) console.log("GOOGLE_PLACES_API_KEY is not set — using the contractor registry.");
    const state = (process.env.STATE ?? "").trim().toUpperCase();
    const trade = (process.env.TRADE ?? "").trim();
    const bids = Math.min(Math.max(Number(process.env.BIDS) || 8, 1), 25);
    if (!/^[A-Z]{2}$/.test(state) || !trade) throw new Error("STATE (two letters) and TRADE are required");
    const rows = await findProspects({ key, state, trade, bids });
    const header = ["bid_id", "bid_title", "buyer", "due", "business", "address", "website", "email", "found_on"];
    writeFileSync("prospects.csv", [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
    console.log(`${rows.length} businesses with a published email. Saved prospects.csv.`);
    process.exit(0);
  } catch (e) {
    console.error("💥 Prospect finder crashed:", e);
    process.exit(1);
  }
}
