/**
 * Finding a bid's buyer for a buyer note (owner 2026-11-14: the first run found
 * a buyer for 5 of 40 bids, because most postings sit on bidding portals that
 * show no buyer email). Two free sources:
 *
 *  1. The official list of every registered .gov domain, published daily by the
 *     .gov registry (CISA) at github.com/cisagov/dotgov-data. It names the
 *     organization, city and state behind each domain, so "Town of Front Royal,
 *     VA" resolves to the town's own website, where its purchasing contact is.
 *  2. An address on a .org/.com/.net/.us domain that carries the agency's own
 *     name (a town on townofexample.org).
 *
 * Everything here is PURE; the fetching is in src/jobs/buyer-notes.ts.
 */
import { siteHost } from "./prospect-finder";

export const GOV_DOMAINS_URL = "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv";

export interface GovDomain {
  domain: string;
  type: string;
  org: string;
  city: string;
  state: string;
}

/** One CSV line into cells (quoted cells may hold commas and doubled quotes). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** The registry CSV as rows. Columns are found by header name, so a reordered file still parses. */
export function parseGovDomains(csv: string): GovDomain[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = csvCells(lines[0]).map((h) => h.toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const d = col(/^domain name$/);
  const t = col(/^domain type$/);
  const o = col(/^organization( name)?$|^agency$/);
  const c = col(/^city$/);
  const s = col(/^state$/);
  if (d < 0 || o < 0 || s < 0) return [];
  const rows: GovDomain[] = [];
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    const domain = (cells[d] ?? "").toLowerCase();
    if (!/^[a-z0-9-]+\.gov$/.test(domain)) continue;
    rows.push({ domain, type: t >= 0 ? cells[t] ?? "" : "", org: cells[o] ?? "", city: c >= 0 ? cells[c] ?? "" : "", state: (cells[s] ?? "").toUpperCase() });
  }
  return rows;
}

const KIND_WORDS = /\b(city|town|township|village|borough|county|parish|municipality)\b/;
const FILLER = /\b(the|of|and|government|govt|public|municipal|corporation|inc|purchasing|procurement|department|dept|office|division|finance)\b/g;

/** "Town of Front Royal" → { kind: "town", core: "front royal" }. */
export function agencyCore(name: string): { kind: string; core: string } {
  // "City of Kalispell, Montana" → the part before the comma; "Commerce, City Of" → "City Of Commerce".
  const [before, after = ""] = name.split(",").map((p) => p.trim());
  const whole = /^(city|town|township|village|borough|county) of$/i.test(after) ? `${after} ${before}` : before;
  const n = whole.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const kind = KIND_WORDS.exec(n)?.[1] ?? "";
  const core = n.replace(new RegExp(KIND_WORDS.source, "g"), " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return { kind, core };
}

const SAME_KIND: Record<string, string> = { township: "town", borough: "town", village: "town", municipality: "city", parish: "county" };
const kindOf = (k: string) => SAME_KIND[k] ?? k;

/**
 * The .gov domain registered to this agency in this state, or null. Only a city,
 * town or county is matched, by its own name: "Fairfax County" never resolves to
 * the City of Fairfax, and a state agency or school district is left alone.
 */
export function govDomainFor(agency: string | null | undefined, state: string | null | undefined, rows: readonly GovDomain[]): string | null {
  const st = (state ?? "").trim().toUpperCase();
  const a = agencyCore(agency ?? "");
  if (!/^[A-Z]{2}$/.test(st) || !a.kind || a.core.length < 3) return null;
  const hits = rows.filter((r) => {
    if (r.state !== st) return false;
    const o = agencyCore(r.org);
    const rowKind = o.kind || (/county/i.test(r.type) ? "county" : /city/i.test(r.type) ? "city" : "");
    if (!rowKind) return false;
    const sameKind = kindOf(rowKind) === kindOf(a.kind) || (kindOf(rowKind) !== "county" && kindOf(a.kind) !== "county");
    return sameKind && o.core === a.core;
  });
  if (!hits.length) return null;
  // Several domains for one government: the one that carries its name reads as the main site.
  const squashed = a.core.replace(/ /g, "");
  return (hits.find((r) => r.domain.includes(squashed)) ?? hits[0]).domain;
}

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|msn|live|comcast|verizon|att|protonmail)\./;

/** True when a .org/.com/.net/.us domain carries the agency's own name ("townofpulaski.org" for the Town of Pulaski). */
export function domainFitsAgency(domain: string, agency: string | null | undefined): boolean {
  const d = domain.toLowerCase();
  if (!/\.(org|com|net|us)$/.test(d) || FREE_MAIL.test(d)) return false;
  const a = agencyCore(agency ?? "");
  const squashed = a.core.replace(/ /g, "");
  if (!a.kind || squashed.length < 5) return false;
  const letters = d.replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]/g, "");
  return letters.includes(squashed);
}

/** Links on an agency's own site that lead to its purchasing office, as absolute URLs. */
export function purchasingLinks(html: string, pageUrl: string, max = 3): string[] {
  const host = siteHost(pageUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!/purchas|procure|\bbids?\b|\brfps?\b|solicitation|vendor/i.test(`${href} ${label.replace(/<[^>]+>/g, " ")}`)) continue;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs) || siteHost(abs) !== host || out.includes(abs) || abs === pageUrl || /\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(abs)) continue;
    out.push(abs);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The address to write to on an agency's own site: its purchasing mailbox when
 * one is published, else a general office mailbox. A named person outside
 * purchasing (the police chief, a council member) is never chosen.
 */
export function pickAgencyAddress(emails: readonly string[], domain: string): string | null {
  const own = emails.map((e) => e.toLowerCase()).filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`));
  const local = (e: string) => e.split("@")[0];
  const usable = own.filter((e) => !/help|support|webmaster|no-?reply|do-?not-?reply|abuse|postmaster|police|sheriff|court|jail|library|utilit|permits?|records|hr$|jobs|careers/.test(local(e)));
  return (
    usable.find((e) => /purchas|procure|\bbids?\b|buyer|contracts?/.test(local(e))) ??
    usable.find((e) => /^(finance|info|clerk|admin|administration|contact|office|cityhall|townhall|townclerk|cityclerk|manager)$/.test(local(e))) ??
    null
  );
}
