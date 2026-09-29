/** Official CSV snapshot; deliberately imported only by the server search route. */
import snapshot from '~/data/grants-snapshot.json';
import { APPLICANT_TYPES, PAGE_SIZE, classifyGrantStatus, mapGrantResult, filterResultsForStatus, tallyGrantStatuses, type GrantsSearchParams } from '~/lib/grants';

const applicantEnums: Record<string, string> = {
  '00':'state_governments', '01':'county_governments', '02':'city_or_township_governments',
  '04':'special_district_governments', '05':'independent_school_districts',
  '06':'public_and_state_institutions_of_higher_education', '07':'federally_recognized_native_american_tribal_governments',
  '08':'public_and_indian_housing_authorities', '11':'other_native_american_tribal_organizations',
  '12':'nonprofits_non_higher_education_with_501c3', '13':'nonprofits_non_higher_education_without_501c3',
  '20':'private_institutions_of_higher_education', '21':'individuals',
  '22':'for_profit_organizations_other_than_small_businesses', '23':'small_businesses', '25':'other', '99':'unrestricted',
};
const categoryEnums: Record<string, string> = {
 AG:'agriculture', AR:'arts', BC:'business_and_commerce', CD:'community_development', CP:'consumer_protection',
 DPR:'disaster_prevention_and_relief', ED:'education', ELT:'employment_labor_and_training', EN:'energy', ENV:'environment',
 FN:'food_and_nutrition', HL:'health', HU:'humanities', IIJ:'infrastructure_investment_and_jobs_act',
 IS:'information_and_statistics', ISS:'income_security_and_social_services', LJL:'law_justice_and_legal_services',
 NR:'natural_resources', O:'other', ST:'science_technology_and_other_research_and_development', T:'transportation',
};
/** Convert the published ISO calendar day to the existing classifier's format. */
function sourceDay(raw: string): string | null {
 const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
 if (!m) return null;
 const d = new Date(raw + 'T00:00:00Z');
 return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === raw ? `${m[2]}/${m[3]}/${m[1]}` : null;
}
const labels = new Map(APPLICANT_TYPES.map(o => [applicantEnums[o.value], o.label]));
export const GRANTS_SNAPSHOT_AS_OF = snapshot.downloadedAt;
export const GRANTS_SNAPSHOT_SIZE = snapshot.records.length;

export function searchGrantsSnapshot(params: GrantsSearchParams, now: Date = new Date()) {
 const words = params.keyword.toLowerCase().split(/\s+/).filter(Boolean);
 const agency = params.agency === 'USDOJ' ? 'DOJ' : params.agency;
 const rows = snapshot.records.filter(r => {
   const text = [r.opportunity_title,r.opportunity_number,r.summary_description,r.agency_name].join(' ').toLowerCase();
   return words.every(w => text.includes(w)) &&
     (!agency || r.agency_code === agency || r.agency_code.startsWith(agency + '-')) &&
     (!params.applicantType || r.applicant_types.split(';').includes(applicantEnums[params.applicantType])) &&
     (!params.fundingCategory || r.funding_categories.split(';').includes(categoryEnums[params.fundingCategory]));
 });
 const hits = rows.map(r => ({ id:r.opportunity_id, number:r.opportunity_number, title:r.opportunity_title,
   agency:r.agency_name, agencyCode:r.agency_code, oppStatus:r.opportunity_status,
   openDate:sourceDay(r.post_date), closeDate:sourceDay(r.close_date) }));
 const tally = tallyGrantStatuses(hits, now);
 const mapped = rows.map((r,i) => {
   const result = mapGrantResult(hits[i], {
     awardFloor:r.award_floor, awardCeiling:r.award_ceiling, estimatedFunding:r.estimated_total_program_funding,
     applicantTypes:r.applicant_types.split(';').filter(Boolean).map(v => labels.get(v) ?? v).concat(r.applicant_eligibility_description ? [r.applicant_eligibility_description] : []),
     synopsisDesc:r.summary_description,
   }, now);
   // Simpler IDs are UUIDs, so preserve the verified URL from the CSV.
   result.officialUrl = r.url;
   result.sourceLastUpdated = r.updated_at || null;
   result.estimatedDeadline = r.opportunity_status === 'forecasted' ? sourceDay(r.forecasted_close_date) : null;
   result.estimatedDeadlinePassed = result.estimatedDeadline !== null &&
     classifyGrantStatus('posted', result.estimatedDeadline, now) === 'expired';
   return result;
 });
 const visible = filterResultsForStatus(mapped, params.status);
 return { results:visible.slice((params.page-1)*PAGE_SIZE, params.page*PAGE_SIZE), totalCount:visible.length,
   asOf:GRANTS_SNAPSHOT_AS_OF,
   excluded:{expiredPosted:tally.expiredPosted,missingDeadline:tally.missingDeadline,forecasts:tally.forecast} };
}
