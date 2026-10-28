/**
 * The Port Authority of New York and New Jersey's public Bonfire board (owner
 * 2026-10-28: "add the Port Authority board"). Captured 2026-10-28: 89 open
 * projects across Commodity/Services, Construction Contracts, Professional
 * Technical & Advisory Services and Aviation.
 *
 * The Port Authority works in both states, and the board carries no per-project
 * location, so each row is placed by the facility its title names: Newark
 * airport, Port Newark, Teterboro, Jersey City, Hoboken or a title saying "in NJ"
 * is New Jersey; LaGuardia, JFK, Stewart, the World Trade Center, the Bus
 * Terminal, Staten Island or "in NY" is New York. A title naming both states,
 * ("Warehouses in NY and NJ"), a bi-state crossing (Lincoln Tunnel, GWB,
 * PATH), or no facility at all stays bi-state: it is listed under New Jersey and
 * its location and description say the agency works in both states.
 *
 * Information pages and lease offerings on the board are skipped. Uses the
 * shared reader's open-status and deadline guards; no detail documents, private
 * opportunities, or registration are accessed.
 */
import type { FetchResult } from "../runner";
import { bonfireAgencyName, fetchBonfireBids, parseBonfire, type BonfireConfig, type BonfirePayload } from "./bonfire-public";

const BUYER = "Port Authority of NY & NJ";
const BOTH_STATES = /\bNY\b[^.]*\bNJ\b|\bNJ\b[^.]*\bNY\b|new york and new jersey|new jersey and new york/i;
const NJ_FACILITY = /\bnewark\b|\bewr\b|teterboro|port jersey|jersey city|hoboken|\bharrison\b|journal square|elizabeth|\bin nj\b|\bin new jersey\b/i;
const NY_FACILITY = /laguardia|\blga\b|\bjfk\b|kennedy|stewart|world trade|\bwtc\b|bus terminal|staten island|howland hook|brooklyn|\bin ny\b|\bin new york\b/i;

export function panynjPlace(title: string): { location: string; stateName: string } {
  const both = BOTH_STATES.test(title);
  const nj = !both && NJ_FACILITY.test(title);
  const ny = !both && NY_FACILITY.test(title);
  if (nj && !ny) return { location: "New Jersey", stateName: "New Jersey" };
  if (ny && !nj) return { location: "New York", stateName: "New York" };
  return { location: "New Jersey (bi-state NY/NJ agency)", stateName: "Bi-state NY/NJ" };
}

export const NJ_PANYNJ_BONFIRE_CONFIG: BonfireConfig = {
  source: "nj_panynj_bonfire",
  host: "https://panynj.bonfirehub.com",
  idPrefix: "panynjbonfire",
  stateName: "New Jersey",
  buyerName: BUYER,
  portalName: "the Port Authority of NY & NJ procurement portal (Bonfire)",
  agencyName: (dept) => {
    const name = bonfireAgencyName(dept, BUYER);
    return name === BUYER ? name : `${BUYER} — ${name}`;
  },
  placeFor: panynjPlace,
  skipTitle: /information only|notice of intent to release|development lease/i,
};

export function parseNjPanynjBonfire(payload: BonfirePayload, now = Date.now()) {
  return parseBonfire(NJ_PANYNJ_BONFIRE_CONFIG, payload, now);
}

export function fetchNjPanynjBonfireBids(now = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(NJ_PANYNJ_BONFIRE_CONFIG, now);
}
