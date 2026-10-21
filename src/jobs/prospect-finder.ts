/**
 * Prospect finder — CLI entrypoint (`bun run prospect-finder`), run by hand
 * from .github/workflows/prospect-finder.yml (owner 2026-10-21). For open bids
 * in one state and trade (due 10+ days out), searches Google Places for local
 * businesses in that trade near each bid, then reads each business's own
 * website for the email addresses it publishes. Prints the list and writes
 * prospects.csv. Read-only on the database; sends nothing.
 *
 * Without GOOGLE_PLACES_API_KEY it prints a note and exits 0. Checking the
 * list against Sent mail and "Do not contact" happens when the emails are
 * written, not here.
 */
import { writeFileSync } from "node:fs";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { bidPlace, contactLinks, csvCell, extractEmails, placesQuery, siteHost } from "~/lib/prospect-finder";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_PER_BID = 10;
const MIN_DAYS_OUT = 10;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; ContraxProspectFinder/1.0; +https://www.contrax.company)";

interface Place {
  name: string;
  website: string | null;
  address: string | null;
}

async function searchPlaces(key: string, query: string): Promise<Place[]> {
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

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return (await res.text()).slice(0, 1_000_000);
  } catch {
    return "";
  }
}

/** Emails published on the homepage, or failing that on up to two contact/about pages. */
async function siteEmails(website: string): Promise<{ emails: string[]; page: string }> {
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
    const query = placesQuery(opts.trade, bidPlace(b.location, b.agency, opts.state));
    console.log(`📄 #${b.id} ${b.title} — ${b.agency ?? "-"}, due ${due}`);
    console.log(`   🔎 ${query}`);
    let places: Place[];
    try {
      places = await searchPlaces(opts.key, query);
    } catch (e) {
      console.log(`   ⚠️ ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const p of places) {
      const host = p.website ? siteHost(p.website) : null;
      if (!p.website || !host || seenSites.has(host)) continue;
      seenSites.add(host);
      const { emails, page } = await siteEmails(p.website);
      if (!emails.length) continue;
      console.log(`   ✉️ ${p.name} — ${emails[0]} (${page})`);
      rows.push([String(b.id), b.title, b.agency ?? "", due, p.name, p.address ?? "", p.website, emails[0], page]);
    }
    console.log("");
  }
  return rows;
}

if (import.meta.main) {
  try {
    const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
    if (!key) {
      console.log("GOOGLE_PLACES_API_KEY is not set yet — nothing to do.");
      process.exit(0);
    }
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
