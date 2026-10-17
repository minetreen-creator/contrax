/** Direct Virginia public-university procurement boards.
 * Virginia Tech: linked at https://www.procurement.vt.edu/supplier-resources.html
 * George Mason: linked at https://fiscal.gmu.edu/purchasing/do-business-with-mason/view-current-solicitation-opportunities/
 * Norfolk State: its public Bonfire tenant and VASCUPP contract links.
 * These complement eVA; overlapping postings are not additional unique contracts.
 * Shared readers retain open-status, close-date, page-count and service guards.
 */
import { bonfireAgencyName, fetchBonfireBids, parseBonfire, type BonfireConfig, type BonfirePayload } from "./bonfire-public";
import { fetchJaggaerBids, parseJaggaerPage, type JaggaerConfig } from "./jaggaer-public";

export const VA_VT_JAGGAER_CONFIG: JaggaerConfig = {
  source: "va_vt_jaggaer", customerOrg: "VATech", idPrefix: "vavtjaggaer",
  stateName: "Virginia", buyerName: "Virginia Tech",
  portalName: "the Virginia Tech Sourcing Portal (JAGGAER)",
};

function universityBonfire(source: string, host: string, idPrefix: string, buyer: string): BonfireConfig {
  return { source, host, idPrefix, stateName: "Virginia", buyerName: buyer,
    portalName: `the ${buyer} Procurement Portal (Bonfire)`,
    agencyName: dept => bonfireAgencyName(dept, buyer) };
}

export const VA_GMU_BONFIRE_CONFIG = universityBonfire(
  "va_gmu_bonfire", "https://gmu.bonfirehub.com", "vagmubonfire", "George Mason University",
);
export const VA_NSU_BONFIRE_CONFIG = universityBonfire(
  "va_nsu_bonfire", "https://nsu.bonfirehub.com", "vansubonfire", "Norfolk State University",
);

export const parseVaVtJaggaer = (html: string, now = Date.now()) => parseJaggaerPage(VA_VT_JAGGAER_CONFIG, html, now);
export const parseVaGmuBonfire = (payload: BonfirePayload, now = Date.now()) => parseBonfire(VA_GMU_BONFIRE_CONFIG, payload, now);
export const parseVaNsuBonfire = (payload: BonfirePayload, now = Date.now()) => parseBonfire(VA_NSU_BONFIRE_CONFIG, payload, now);
export const fetchVaVtJaggaerBids = (now = Date.now()) => fetchJaggaerBids(VA_VT_JAGGAER_CONFIG, now);
export const fetchVaGmuBonfireBids = (now = Date.now()) => fetchBonfireBids(VA_GMU_BONFIRE_CONFIG, now);
export const fetchVaNsuBonfireBids = (now = Date.now()) => fetchBonfireBids(VA_NSU_BONFIRE_CONFIG, now);
