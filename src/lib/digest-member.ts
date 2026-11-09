/**
 * One member's share of the morning's new bids, and their Auto-Pilot inputs. Shared by the email
 * job and Auto-Pilot's early scoring so both pick the same bids. PURE.
 */
import { buildDigestMatcher, type DigestBidFields, type DigestMatcher, type DigestProfile } from "~/lib/digest-match";
import { splitDigestBids } from "~/lib/digest-open-to-all";
import { profileList, type AutopilotBid, type AutopilotProfile } from "~/lib/autopilot";

type Bid = { bid_id: number; title: string; agency?: string | null; location?: string | null; due_date: string | null; set_aside?: string | null; source?: string | null; match: DigestBidFields };

export function memberDigestBids<T extends Bid>(member: DigestProfile, bids: readonly T[]): { matcher: DigestMatcher; main: T[]; openToAll: T[] } {
  const matcher = buildDigestMatcher(member);
  const matched = matcher.personal ? bids.filter((b) => matcher.matches(b.match)) : [...bids];
  // Federal bids with no set-aside go in their own block; market research and overseas work
  // are left out (owner 2026-11-09, src/lib/digest-open-to-all.ts).
  const { main, openToAll } = splitDigestBids(matched);
  return { matcher, main, openToAll };
}

export function autopilotProfileOf(m: Record<string, any>): AutopilotProfile {
  return {
    businessName: m.business_name ?? null,
    industry: m.industry ?? null,
    naicsCodes: profileList(m.naics_codes),
    serviceCategories: profileList(m.service_categories),
    locations: profileList(m.locations),
    certifications: profileList(m.certifications),
    licenses: profileList(m.licenses),
    yearsInBusiness: m.years_in_business ?? null,
    employeeCount: m.employee_count ?? null,
    typicalContractValue: m.typical_contract_value ?? null,
    pastPerformance: m.past_performance_summary ?? null,
    capabilityStatement: m.capability_statement ?? null,
  };
}

/** The bids Auto-Pilot reads for a member, in the order it reads them (their own list first). */
export function autopilotBidsOf(main: readonly Bid[], openToAll: readonly Bid[]): AutopilotBid[] {
  return [...main, ...openToAll].map((b) => ({
    bid_id: Number(b.bid_id),
    title: b.title,
    agency: b.agency ?? null,
    location: b.location ?? null,
    due_date: b.due_date,
    set_aside: b.set_aside ?? null,
    description: b.match.description ?? null,
  }));
}
