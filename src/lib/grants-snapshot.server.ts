/**
 * Official CSV snapshot, used only by the server search route.
 *
 * The file (1.4 MB) is a static asset, public/data/grants-snapshot.json, fetched once per server
 * instance from the site serving the request (owner 2026-11-17: the render function was 100 bytes
 * under its 12 MB ceiling and this was its largest single item). Same pattern as the ZIP table in
 * src/lib/town/data.ts. It is public federal data, already shown on the grants page.
 */
import { gunzipSync } from 'node:zlib';
type SnapshotRow = Record<'opportunity_id'|'opportunity_number'|'opportunity_title'|'opportunity_status'|'agency_code'|'agency_name'|'post_date'|'close_date'|'forecasted_close_date'|'updated_at'|'estimated_total_program_funding'|'award_floor'|'award_ceiling'|'applicant_types'|'applicant_eligibility_description'|'funding_categories'|'summary_description'|'url', string>;
export interface GrantsSnapshot { records: SnapshotRow[]; asOf: string }

/** The file's own shape → usable rows. Throws when the row count does not match the file's own count. */
export function decodeGrantsSnapshot(raw: { downloadedAt: string; recordCount: number; recordsGzipBase64: string }): GrantsSnapshot {
  const records: SnapshotRow[] = JSON.parse(gunzipSync(Buffer.from(raw.recordsGzipBase64, 'base64')).toString('utf8'));
  if (records.length !== raw.recordCount) throw new Error('Incomplete grants snapshot');
  return { records, asOf: raw.downloadedAt };
}

let loaded: Promise<GrantsSnapshot> | null = null;
/** Fetched once per server instance; a failed load is forgotten so the next request tries again. */
export function loadGrantsSnapshot(origin: string): Promise<GrantsSnapshot> {
  if (!loaded) {
    loaded = (async () => {
      for (const o of [...new Set([origin, 'https://www.contrax.company'])]) {
        try {
          const res = await fetch(`${o}/data/grants-snapshot.json`, { signal: AbortSignal.timeout(10_000) });
          if (res.ok) return decodeGrantsSnapshot(await res.json());
        } catch {
          /* try the next origin */
        }
      }
      throw new Error('grants-snapshot.json unavailable');
    })();
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}
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

/** The search itself, over rows already loaded (PURE). */
export function searchGrantsRecords(snap: GrantsSnapshot, params: GrantsSearchParams, now: Date = new Date()) {
 const words = params.keyword.toLowerCase().split(/\s+/).filter(Boolean);
 const agency = params.agency === 'USDOJ' ? 'DOJ' : params.agency;
 const rows = snap.records.filter(r => {
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
   asOf:snap.asOf,
   excluded:{expiredPosted:tally.expiredPosted,missingDeadline:tally.missingDeadline,forecasts:tally.forecast} };
}

/** Loads the snapshot (once per server instance) and searches it. `origin` is the site serving this request. */
export async function searchGrantsSnapshot(params: GrantsSearchParams, origin: string, now: Date = new Date()) {
 return searchGrantsRecords(await loadGrantsSnapshot(origin), params, now);
}
