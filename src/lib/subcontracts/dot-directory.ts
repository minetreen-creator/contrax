/** DOT's published directory is a company list, never an open opportunity. */
import { normalizeStateInput } from "~/lib/location-state";
export const DOT_DIRECTORY_URL =
  "https://www.transportation.gov/osdbu/procurement-assistance/dot-subcontracting-directory";

export interface DotListing {
  name: string;
  address: string;
  state: string;
  naics: string;
  services: string;
  liaison: string;
}

export interface MatchablePrime {
  id: string;
  uei: string;
  name: string;
  state: string | null;
  naics: string[];
  address: string | null;
}

export type DotDecision =
  | { kind: "matched"; listing: DotListing; primeId: string; uei: string }
  | { kind: "review"; listing: DotListing; reason: string };

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    const named: Record<string, string> = {
      amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">",
    };
    const key = entity.toLowerCase();
    if (key in named) return named[key]!;
    const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  });
}

function cellText(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Fail closed when DOT changes the table shape. No partial import. */
export function parseDotDirectory(html: string): DotListing[] {
  if (!/FY2026 Subcontracting Directory/i.test(html)) throw new Error("DOT fiscal-year heading missing");
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((match) => match[1]!)
    .find((body) => /Vendor Name/i.test(body) && /Official's Name and Phone/i.test(body));
  if (!table) throw new Error("DOT directory table missing");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
  if (!rows.length) throw new Error("DOT directory is empty");
  return rows.map((row, index) => {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]!));
    if (cells.length !== 5) throw new Error(`DOT row ${index + 1}: expected five cells`);
    const [name, address, naics, services, liaison] = cells as [string, string, string, string, string];
    if (!name || !address) throw new Error(`DOT row ${index + 1}: missing identity`);
    // An unparseable address stays in the private review bucket; it cannot match.
    const state = /,\s*([A-Z]{2})\.?\s+\d{5}(?:-\d+)?\b/i.exec(address)?.[1]?.toUpperCase() ?? "";
    return { name, address, state, naics, services, liaison };
  });
}

const canonicalName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
const canonicalNaics = (entry: string) => /^\d{6}/.exec(entry.trim())?.[0] ?? "";
function streetAndZip(address: string | null): string | null {
  if (!address) return null;
  const normalized = address.toUpperCase().replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const street = /^(\d+[A-Z]?)\s+([A-Z0-9]+)/.exec(normalized);
  const zip = /\b(\d{5})(?:\s+\d{4})?\b(?!.*\d{5})/.exec(normalized);
  return street && zip ? `${street[1]}:${street[2]}:${zip[1]}` : null;
}

/** Exact company + state + NAICS + street number/name + ZIP, one distinct UEI. */
export function matchDotListings(
  listings: readonly DotListing[],
  primes: readonly MatchablePrime[],
): DotDecision[] {
  const decisions: DotDecision[] = listings.map((listing) => {
    const addressKey = streetAndZip(listing.address);
    if (!listing.state || !/^\d{6}$/.test(listing.naics) || !addressKey) {
      return { kind: "review", listing, reason: "state, NAICS or address unavailable" };
    }
    const candidates = primes.filter((prime) =>
      canonicalName(prime.name) === canonicalName(listing.name) &&
      normalizeStateInput(prime.state) === listing.state &&
      streetAndZip(prime.address) === addressKey &&
      prime.naics.some((code) => canonicalNaics(code) === listing.naics));
    const ueis = new Set(candidates.map((candidate) => candidate.uei));
    if (ueis.size !== 1) {
      return { kind: "review", listing, reason: ueis.size ? "ambiguous identity" : "no exact match" };
    }
    // Prefer a single existing row for the one UEI; publication never creates a new prime.
    const prime = candidates[0]!;
    return { kind: "matched", listing, primeId: prime.id, uei: prime.uei };
  });
  const frequency = new Map<string, number>();
  for (const item of decisions) if (item.kind === "matched") {
    frequency.set(item.uei, (frequency.get(item.uei) ?? 0) + 1);
  }
  return decisions.map((item) => item.kind === "matched" && frequency.get(item.uei)! > 1
    ? { kind: "review", listing: item.listing, reason: "duplicate DOT identity" }
    : item);
}
