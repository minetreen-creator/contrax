import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { reviewOhioText } from '../src/jobs/sources/ohiobuys-text';
import { syncSource } from '../src/jobs/runner';

const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('Provide a copied OhioBuys public table text file');
const report = reviewOhioText(await readFile(file,'utf8'));
console.log(JSON.stringify({fetched:report.fetched,eligible:report.rows.length,skipped:report.skipped},null,2));
if (process.argv.includes('--apply')) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for --apply');
  const sql = neon(process.env.DATABASE_URL);
  const existing = await sql`SELECT solicitation_number FROM bids WHERE normalized_state = 'OH' AND solicitation_number IS NOT NULL`;
  const ids = new Set(existing.map(r=>String(r.solicitation_number).trim()));
  const candidates = report.rows.filter(r=>!ids.has(r.solicitation_number!));
  console.log(`Existing matches: ${report.rows.length-candidates.length}; candidates: ${candidates.length}`);
  const result = await syncSource(sql,{name:'ohiobuys',fetchFn:async()=>candidates});
  console.log(JSON.stringify(result,null,2));
  if (result.failed || result.errors.length) process.exitCode=1;
} else console.log('Dry run only. No database writes.');
