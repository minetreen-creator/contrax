// PlanetBids public "Bid Opportunities" pages (owner 2026-11-08: "Yes, use a real browser").
// Loads an agency's public portal page in a real browser, exactly as any visitor sees it, and
// records the open ("Bidding" stage) bids the page itself lists. No sign-in, no submissions.
// PlanetBids refuses direct data requests from programs ("DIRECT_ACCESS"), so the list is read
// only through the page's own requests, inside the page.
//
// Env: PLANETBIDS_CID (agency company id, e.g. 22576 for the City of Toledo), PLANETBIDS_OUT.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const cid = String(process.env.PLANETBIDS_CID || '');
if (!/^\d+$/.test(cid)) { console.error('PLANETBIDS_CID missing'); process.exit(1); }
const portal = `https://vendors.planetbids.com/portal/${cid}/bo/bo-search`;
const PER_PAGE = 30;
const MAX_PAGES = 10;
// Owner 2026-11-14 ("fix it now"): PlanetBids drops a request now and then, so a board that loads
// fine a minute later failed whole syncs (Rialto, Corona, RCTC). Each capture now gets up to
// MAX_ATTEMPTS fresh page loads, a short pause apart, and each list page one retry, before the
// board counts as failed. Still one browser, the same public page, our own name.
const MAX_ATTEMPTS = 3;
const RETRY_PAUSE_MS = [0, 8_000, 20_000];
let browser;
const started = Date.now();
const timer = setTimeout(() => { console.error('PlanetBids collector timed out'); process.exit(1); }, 170_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One full capture on a fresh page. Throws on any failure. */
async function capture() {
  const page = await browser.newPage();
  try {
    // Our own honest name, as in every Contrax request (never a pretend consumer browser).
    await page.setUserAgent('Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)');
    const seen = [];
    page.on('response', (res) => { const u = res.url(); if (u.includes('api-external')) seen.push(`${res.status()} ${u.split('?')[0].slice(-60)}`); });
    let listHeaders = null;
    let listUrl = null;
    page.on('request', (req) => {
      const u = req.url();
      if (!listUrl && u.includes('api-external') && /\/papi\/bids\?/.test(u)) { listUrl = u; listHeaders = req.headers(); }
    });
    await page.goto(portal, { waitUntil: 'networkidle2', timeout: 45_000 });
    const deadline = Date.now() + 20_000;
    while (!listUrl && Date.now() < deadline) await sleep(500);
    if (!listUrl) throw new Error(`The public bid list never loaded (page changed). Requests seen: ${seen.slice(0, 15).join('; ')}`);
    // The page's own list request, filtered to the "Bidding" stage (the Stage filter on the page).
    const base = new URL(listUrl);
    const result = await page.evaluate(async ({ base, headers, perPage, maxPages, cid }) => {
      const keep = {};
      for (const [k, v] of Object.entries(headers || {})) if (!/^(host|content-length|cookie)$/i.test(k)) keep[k] = v;
      const get = async (url) => {
        try { return await fetch(url, { headers: keep, credentials: 'include' }); }
        catch { await new Promise((r) => setTimeout(r, 2000)); return fetch(url, { headers: keep, credentials: 'include' }); }
      };
      const bids = [];
      for (let p = 1; p <= maxPages; p++) {
        const u = new URL(base);
        u.searchParams.set('stage_id', '3');
        u.searchParams.set('page', String(p));
        u.searchParams.set('per_page', String(perPage));
        u.searchParams.set('cid', cid);
        const r = await get(u.toString());
        if (!r.ok) return { error: `HTTP ${r.status} on page ${p}` };
        const j = await r.json();
        if (!Array.isArray(j.data)) return { error: 'Unexpected list shape' };
        bids.push(...j.data.map((d) => d.attributes));
        if (j.data.length < perPage) return { bids, pages: p, complete: true };
      }
      return { bids, pages: maxPages, complete: false };
    }, { base: base.toString(), headers: listHeaders, perPage: PER_PAGE, maxPages: MAX_PAGES, cid });
    if (result.error) throw new Error(result.error);
    if (!result.complete) throw Object.assign(new Error(`More than ${MAX_PAGES} pages of open bids; refusing a truncated list`), { final: true });
    const agency = await page.evaluate(async ({ cid, headers }) => {
      const keep = {};
      for (const [k, v] of Object.entries(headers || {})) if (!/^(host|content-length|cookie)$/i.test(k)) keep[k] = v;
      const r = await fetch(`https://api-external.prod.planetbids.com/papi/agencies/${cid}`, { headers: keep, credentials: 'include' });
      if (!r.ok) return null;
      const a = (await r.json()).data?.attributes;
      return a ? { companyId: a.companyId, companyName: a.companyName, timeZoneName: a.timeZoneName } : null;
    }, { cid, headers: listHeaders });
    if (!agency || String(agency.companyId) !== cid) throw new Error('Agency identity missing or mismatched');
    return { agency, bids: result.bids };
  } finally {
    await page.close().catch(() => {});
  }
}

try {
  browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pause = RETRY_PAUSE_MS[attempt - 1] ?? 20_000;
    // Each attempt needs up to ~70 s; never start one the overall timer would cut off.
    if (attempt > 1 && Date.now() - started + pause > 95_000) break;
    if (pause) { console.error(`  attempt ${attempt - 1} failed (${last.message.slice(0, 120)}); retrying in ${pause / 1000}s`); await sleep(pause); }
    try {
      const { agency, bids } = await capture();
      const payload = { capturedAt: new Date().toISOString(), cid: Number(cid), agency, bids };
      writeFileSync(process.env.PLANETBIDS_OUT || `planetbids-${cid}.json`, JSON.stringify(payload, null, 1));
      console.log(`PlanetBids ${agency.companyName}: ${bids.length} open bids captured${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      last = null;
      break;
    } catch (error) {
      last = error;
      if (error.final) break;
    }
  }
  if (last) throw last;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
}
