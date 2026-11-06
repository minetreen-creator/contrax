// Public Oracle Fusion "Negotiation/Solicitation Abstracts" lists only. No sign-in, no submissions,
// no database access. Opens ORACLE_ENDPOINT in headless Chrome, sets the page's own Status filter to
// "Active", presses its Search button and writes what the table then shows to ORACLE_OUT.
// Why a browser: the plain page returns only the 21 newest rows of every status; the Active filter is
// an ADF form post that only the page's own script can make.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const endpoint = process.env.ORACLE_ENDPOINT;
const out = process.env.ORACLE_OUT || 'oracle-payload.json';
if (!endpoint || !/^https:\/\/[a-z0-9.-]+\.oraclecloud\.com\/fscmUI\/faces\/NegotiationAbstracts\?prcBuId=\d+$/.test(endpoint)) {
  console.error('ORACLE_ENDPOINT must be a public NegotiationAbstracts URL');
  process.exit(1);
}
const ROWS = 'table[summary="Search Results"] tbody > tr';
const EMPTY = /No data to display|No results found/i;
let browser;
const timer = setTimeout(() => { console.error('Oracle abstracts collector timed out'); process.exit(1); }, 150_000);
try {
  browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(endpoint, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction((rows, empty) => document.querySelector(rows) || new RegExp(empty, 'i').test(document.body.innerText),
    { timeout: 60_000 }, ROWS, EMPTY.source);
  // Open the filter panel when it is collapsed, then choose Status = Active.
  const select = 'select[id$="qryId1:value00::content"]';
  if (!(await page.$(select))) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('a,button,div[role=button]')].find((e) => /show filters/i.test(e.innerText || e.title || ''));
      b?.click();
    });
  }
  await page.waitForSelector(select, { timeout: 20_000 });
  const active = await page.$$eval(`${select} option`, (os) => os.find((o) => o.textContent.trim() === 'Active')?.value);
  if (!active) throw new Error('Status filter has no "Active" choice');
  await page.select(select, active);
  await page.waitForNetworkIdle({ idleTime: 1000, timeout: 20_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[id$="qryId1::search"]')].find((e) => e.offsetParent !== null) ?? document.querySelector('button[id$="qryId1::search"]');
    b?.click();
    return !!b;
  });
  if (!pressed) throw new Error('Filter Search button missing');
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30_000 }).catch(() => {});
  await page.waitForFunction((rows, empty) => {
    const r = [...document.querySelectorAll(rows)];
    return (r.length && r.every((x) => x.children[3]?.innerText.trim() === 'Active')) || new RegExp(empty, 'i').test(document.body.innerText);
  }, { timeout: 30_000 }, ROWS, EMPTY.source);
  const payload = await page.evaluate((rows) => {
    const tz = /Time Zone\s+([A-Z][A-Za-z ]*? Time)\b/.exec(document.body.innerText)?.[1] ?? null;
    return {
      capturedAt: new Date().toISOString(),
      endpoint: location.href.split('&')[0],
      filter: 'Active',
      timeZone: tz,
      rows: [...document.querySelectorAll(rows)].map((row) => [...row.children].map((cell) => cell.innerText.trim())),
    };
  }, ROWS);
  payload.endpoint = endpoint;
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`Oracle abstracts: ${payload.rows.length} Active rows captured (${payload.timeZone})`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
}
