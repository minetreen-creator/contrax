/**
 * More firms for the reseller email (owner 2026-11-15, "We need more than 8"). Kept beside the
 * job, not in src/lib, so the list adds nothing to the server bundle.
 *
 * Unlike the hand-checked seeds in src/lib/outreach.ts, these were collected from directories,
 * rankings and search results and NOT each read by hand. So a lead is only written to when its
 * own home page (1) says it helps others win government work (partnerSiteFits) and (2) carries
 * the firm's name (nameOnSite), which catches an address that belongs to somebody else.
 */
export const PARTNER_LEADS: readonly (readonly [string, string])[] = [
  ["Fedmarket", "https://www.fedmarket.com"],
  ["Federal Schedules", "https://gsa.federalschedules.com"],
  ["Centre Law & Consulting", "https://centrelawgroup.com"],
  ["Road Map Consulting", "https://www.roadmapc.com"],
  ["EZGSA", "https://ezgsa.com"],
  ["The Gormley Group", "https://gormgroup.com"],
  ["Shipley Associates", "https://www.shipleywins.com"],
  ["Jefferson Consulting Group", "https://jeffersonconsulting.com"],
  ["RSM Federal", "https://www.rsmfederal.com"],
  ["TargetGov", "https://www.targetgov.com"],
  ["Govology", "https://govology.com"],
  ["The RFP Success Company", "https://www.therfpsuccesscompany.com"],
  ["Ferlise Associates", "https://ferliseassociates.com"],
  ["Proposal Foundry", "https://proposal-foundry.com"],
  ["BAFO Services", "https://www.bafoservices.com"],
  ["WinBiz Consulting", "https://winbizconsulting.com"],
  ["Breen Consulting Group", "https://breenconsulting.com"],
  ["SDV International", "https://www.sdvinternational.com"],
  ["Lohfeld Consulting Group", "https://lohfeldconsulting.com"],
  ["Key Solutions", "https://www.keysolutionsinc.com"],
  ["Red Team Consulting", "https://www.redteamconsulting.com"],
  ["Hinz Consulting", "https://hinzconsulting.com"],
  ["Summit Strategy", "https://summitstrategywins.com"],
  ["24 Hour Company", "https://www.24hrco.com"],
  ["Summit Insight", "https://summitinsight.com"],
  ["Solvability", "https://solvability.com"],
  ["Deep Water Point", "https://deepwaterpoint.com"],
  ["GSA Focus", "https://www.gsafocus.com"],
  ["TurboGSA", "https://turbogsa.com"],
  ["Price Reporter", "https://pricereporter.com"],
  ["Rainmakerz Consulting", "https://rainmakerz.biz"],
  ["Federal Proposal Experts", "https://federalproposalexperts.com"],
  ["BidExecs", "https://bidexecs.com"],
  ["GDI Consulting", "https://gdicwins.com"],
  ["Trident Proposal Management", "https://tridentproposals.com"],
  ["Federal Sales Sherpa", "https://federalsalessherpa.com"],
  ["Jennifer Schaus & Associates", "https://jenniferschaus.com"],
  ["FedSavvy Strategies", "https://fedsavvystrategies.com"],
  ["Wolf Den Associates", "https://wolfdenassociates.com"],
  ["ProposalHelper", "https://proposalhelper.com"],
  ["Organizational Communications", "https://orgcom.com"],
  ["CapturePlanning", "https://www.captureplanning.com"],
  ["SMA", "https://www.smawins.com"],
  ["DoD Contract Academy", "https://www.dodcontract.com"],
  ["GovCon Winners", "https://govconwinners.com"],
  ["Cloveer", "https://www.cloveer.com"],
  ["Pierce GSA Consulting", "https://piercegsaconsulting.com"],
  ["GCO Consulting Group", "https://gcoconsult.com"],
  ["Heron Writing & Consulting", "https://heronwriting.com"],
  ["Agility Development Group", "https://agilitydevelopmentgroup.com"],
  ["B2G Connect", "https://b2gconnect.com"],
  ["Strategic Growth Advisors", "https://strategicgrowthadvisors.com"],
  ["Sharp Proposal", "https://sharpproposal.com"],
  ["Proposal Development Consultants", "https://proposaldc.com"],
  ["Capitol Federal Consulting", "https://capitolfederalconsulting.com"],
  ["GovCon Navigators", "https://govconnavigators.com"],
  ["Federal Contracts Corp Consulting", "https://federalcontractsconsulting.com"],
  ["Bid Solutions Group", "https://bidsolutionsgroup.com"],
  ["The Proposal Lab", "https://theproposallab.com"],
];

/** Words too common in these firms' names to prove a page is theirs. */
const GENERIC = new Set(["the", "and", "of", "for", "llc", "inc", "co", "corp", "company", "group", "consulting", "consultants", "associates", "solutions", "services", "strategies", "advisors", "management", "international", "global"]);

/**
 * True when the page carries the firm's name: every distinctive word of the name appears in the
 * page text (spaces and punctuation ignored, so "Road Map" matches "RoadMap"). A name with no
 * distinctive word at all never matches. PURE.
 */
export function nameOnSite(name: string, page: string): boolean {
  const flat = page.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC.has(w));
  return words.length > 0 && words.every((w) => flat.includes(w));
}
