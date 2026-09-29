import { expect, test } from 'bun:test';
import snapshot from '~/data/grants-snapshot.json';
import { searchGrantsSnapshot, GRANTS_SNAPSHOT_SIZE } from './grants-snapshot.server';
import type { GrantsSearchParams } from './grants';
const base: GrantsSearchParams = {keyword:'',applicantType:null,fundingCategory:null,agency:null,status:'open',page:1};
const now = new Date('2026-09-29T21:10:00Z');
test('imports every unique opportunity and preserves official UUID links', () => {
 expect(GRANTS_SNAPSHOT_SIZE).toBe(1518);
 expect(new Set(snapshot.records.map(r => r.opportunity_id)).size).toBe(1518);
 const r = searchGrantsSnapshot({...base,keyword:'RFA-AG-27-007'},now);
 expect(r.totalCount).toBe(1);
 expect(r.results[0].officialUrl).toBe('https://simpler.grants.gov/opportunity/265e7e39-c42a-455c-9147-c9b442e02c6d');
 expect(r.results[0].estimatedFunding).toBe('Est. $1,500,000');
});
test('deadlines age; forecast records never become open', () => {
 const r = searchGrantsSnapshot(base,now);
 expect(r.results.every(x => x.derivedStatus === 'open')).toBe(true);
 expect(r.excluded.forecasts).toBe(611);
 expect(searchGrantsSnapshot({...base,status:'forecast'},now).totalCount).toBe(611);
 expect(searchGrantsSnapshot({...base,keyword:'RFA-AG-27-007'},new Date('2026-09-30T12:00:00Z')).totalCount).toBe(0);
});
test('filter codes match CSV enums and pagination is stable', () => {
 const p = {...base,status:'forecast' as const,applicantType:'23',fundingCategory:'ST'};
 const r = searchGrantsSnapshot(p,now);
 const expected = snapshot.records.filter(x => x.opportunity_status==='forecasted' && x.applicant_types.split(';').includes('small_businesses') && x.funding_categories.split(';').includes('science_technology_and_other_research_and_development'));
 expect(r.totalCount).toBe(expected.length);
 expect(searchGrantsSnapshot({...base,status:'forecast',page:2},now).results[0].id).not.toBe(searchGrantsSnapshot({...base,status:'forecast'},now).results[0].id);
 expect(searchGrantsSnapshot({...base,keyword:'__no_such_grant__'},now).totalCount).toBe(0);
});
