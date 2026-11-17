import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { decodeGrantsSnapshot, loadGrantsSnapshot, searchGrantsRecords } from './grants-snapshot.server';
import type { GrantsSearchParams } from './grants';
const base: GrantsSearchParams = {keyword:'',applicantType:null,fundingCategory:null,agency:null,status:'open',page:1};
const now = new Date('2026-09-29T21:10:00Z');
const RAW = JSON.parse(readFileSync('public/data/grants-snapshot.json', 'utf8'));
const SNAP = decodeGrantsSnapshot(RAW);
const GRANTS_SNAPSHOT_RECORDS = SNAP.records;
const GRANTS_SNAPSHOT_SIZE = SNAP.records.length;
const searchGrantsSnapshot = (p: GrantsSearchParams, n: Date) => searchGrantsRecords(SNAP, p, n);
test('imports every unique opportunity and preserves official UUID links', () => {
 expect(GRANTS_SNAPSHOT_SIZE).toBe(1518);
 expect(new Set(GRANTS_SNAPSHOT_RECORDS.map(r => r.opportunity_id)).size).toBe(1518);
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
 const expected = GRANTS_SNAPSHOT_RECORDS.filter(x => x.opportunity_status==='forecasted' && x.applicant_types.split(';').includes('small_businesses') && x.funding_categories.split(';').includes('science_technology_and_other_research_and_development'));
 expect(r.totalCount).toBe(expected.length);
 expect(searchGrantsSnapshot({...base,status:'forecast',page:2},now).results[0].id).not.toBe(searchGrantsSnapshot({...base,status:'forecast'},now).results[0].id);
 expect(searchGrantsSnapshot({...base,keyword:'__no_such_grant__'},now).totalCount).toBe(0);
});

test('the file is a static asset, not part of the server bundle, and loads once per instance', async () => {
 const server = readFileSync('src/lib/grants-snapshot.server.ts', 'utf8');
 expect(server).not.toContain("from '~/data/grants-snapshot.json'");
 expect(() => readFileSync('src/data/grants-snapshot.json')).toThrow();
 expect(() => decodeGrantsSnapshot({ ...RAW, recordCount: RAW.recordCount + 1 })).toThrow('Incomplete grants snapshot');
 const real = globalThis.fetch; let calls = 0;
 globalThis.fetch = (async (u: string) => { calls++; expect(String(u)).toBe('https://preview.example/data/grants-snapshot.json'); return new Response(JSON.stringify(RAW), { status: 200 }); }) as typeof fetch;
 try {
  const a = await loadGrantsSnapshot('https://preview.example');
  const b = await loadGrantsSnapshot('https://preview.example');
  expect(a.records.length).toBe(1518);
  expect(b).toBe(a);
  expect(calls).toBe(1);
 } finally { globalThis.fetch = real; }
 expect(readFileSync('src/routes/api/grants/search.ts', 'utf8')).toContain('await searchGrantsSnapshot(params, url.origin)');
});
